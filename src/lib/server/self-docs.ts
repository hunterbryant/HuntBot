import { readRepoFile } from '$lib/server/github-repo';
import { describeError } from '$lib/server/tool-log';
import { getEmbeddings } from '$lib/utilities/context';
import { compile } from 'html-to-text';

// Answers "how do you work?" from HuntBot's own write-ups instead of the first 8,000 characters of
// whichever file the model happened to read. Sources: the Building HuntBot post (plain language,
// best for visitors) and the repo's docs (precise, for follow-ups). Both are split into sections,
// embedded once per warm instance, and the best few sections for the question come back.

const SITE_ORIGIN = 'https://www.hunterbryant.io';
const POST_PATH = '/projects/building-huntbot';
const POST_LABEL = 'Building HuntBot post';
const DOC_FILES = [
	'docs/chat-pipeline.md',
	'docs/tools.md',
	'docs/visitor-context.md',
	'docs/knowledge-base.md',
	'docs/observability.md',
	'CLAUDE.md'
];

const MAX_SECTION_CHARS = 1500;
const TOP_SECTIONS = 4;
const MAX_RESULT_CHARS = 6000;
const INDEX_TTL_MS = 30 * 60_000;
// Visitors ask in plain words, and the post is written for them; keep it ahead of the docs on ties.
const POST_BOOST = 0.03;

const toText = compile({ wordwrap: false });

export type DocSection = { label: string; text: string; fromPost: boolean };
export type RankedSection = DocSection & { score: number };

type Index = { expires: number; sections: DocSection[]; vectors: number[][] };
let index: Index | null = null;
let building: Promise<Index | null> | null = null;

// Tried in order: blank-line gaps, then single lines (lists), then sentences, then a hard cut.
const SEPARATORS: { split: RegExp; join: string }[] = [
	{ split: /\n{2,}/, join: '\n\n' },
	{ split: /\n/, join: '\n' },
	{ split: /(?<=[.!?])\s+/, join: ' ' }
];

/** Packs text into pieces of at most `max` characters, cutting at the coarsest boundary that fits. */
export function splitBySize(text: string, max = MAX_SECTION_CHARS, level = 0): string[] {
	const trimmed = text.trim();
	if (!trimmed) return [];
	if (trimmed.length <= max) return [trimmed];
	if (level >= SEPARATORS.length) {
		const out: string[] = [];
		for (let i = 0; i < trimmed.length; i += max) out.push(trimmed.slice(i, i + max));
		return out;
	}

	const { split, join } = SEPARATORS[level];
	const out: string[] = [];
	let current = '';
	for (const part of trimmed.split(split)) {
		const p = part.trim();
		if (!p) continue;
		if (p.length > max) {
			if (current) out.push(current);
			current = '';
			out.push(...splitBySize(p, max, level + 1));
			continue;
		}
		if (current && current.length + join.length + p.length > max) {
			out.push(current);
			current = '';
		}
		current = current ? `${current}${join}${p}` : p;
	}
	if (current) out.push(current);
	return out;
}

/** Splits a markdown file at its headings (levels 1–3); each section is labeled with its heading path. */
export function splitMarkdown(file: string, md: string): DocSection[] {
	const sections: DocSection[] = [];
	const path: string[] = [];
	let body: string[] = [];
	let inFence = false;

	const flush = () => {
		const label = [file, ...path].join(' › ');
		for (const piece of splitBySize(body.join('\n'))) {
			sections.push({ label, text: piece, fromPost: false });
		}
		body = [];
	};

	for (const line of md.split('\n')) {
		if (line.startsWith('```')) inFence = !inFence;
		const heading = inFence ? null : /^(#{1,3})\s+(.*)$/.exec(line);
		if (heading) {
			flush();
			path.length = heading[1].length - 1;
			path[heading[1].length - 1] = heading[2].trim();
		} else {
			body.push(line);
		}
	}
	flush();
	return sections;
}

// html-to-text upper-cases headings, so a short all-caps line is a heading in the post's text.
const POST_HEADING = /^[A-Z0-9][A-Z0-9 .,'’&()/:-]{2,80}$/;

/** Splits the post's plain text at its (upper-cased) headings. */
export function splitPost(text: string): DocSection[] {
	const sections: DocSection[] = [];
	let heading = '';
	let body: string[] = [];
	const flush = () => {
		const label = heading ? `${POST_LABEL} › ${heading}` : POST_LABEL;
		// Single newlines are just line wrapping; paragraphs are the blank-line gaps.
		const joined = body.join('\n').replace(/\n(?!\n)/g, ' ');
		for (const piece of splitBySize(joined)) sections.push({ label, text: piece, fromPost: true });
		body = [];
	};
	for (const line of text.split('\n')) {
		const t = line.trim();
		if (POST_HEADING.test(t) && /[A-Z]{3}/.test(t)) {
			flush();
			heading = t.charAt(0) + t.slice(1).toLowerCase();
		} else {
			body.push(line);
		}
	}
	flush();
	return sections;
}

async function fetchPost(): Promise<string | null> {
	try {
		const res = await fetch(`${SITE_ORIGIN}${POST_PATH}`, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return null;
		return toText(await res.text());
	} catch {
		return null;
	}
}

async function buildIndex(): Promise<Index | null> {
	const [post, ...docs] = await Promise.all([
		fetchPost(),
		...DOC_FILES.map((path) => readRepoFile(path, { maxChars: 200_000 }))
	]);

	const sections: DocSection[] = [];
	if (post) sections.push(...splitPost(post));
	docs.forEach((file, i) => {
		if (file) sections.push(...splitMarkdown(DOC_FILES[i], file.content));
	});
	if (sections.length === 0) return null;

	const vectors = await getEmbeddings().embedDocuments(
		sections.map((s) => `${s.label}\n${s.text}`)
	);
	return { expires: Date.now() + INDEX_TTL_MS, sections, vectors };
}

async function getIndex(): Promise<Index | null> {
	if (index && index.expires > Date.now()) return index;
	// Concurrent first calls share one build.
	building ??= buildIndex()
		.then((built) => {
			if (built) index = built;
			return built ?? index;
		})
		.finally(() => {
			building = null;
		});
	return building;
}

function cosine(a: number[], b: number[]): number {
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** The sections most relevant to `question`, best first, capped at MAX_RESULT_CHARS in total. */
export function rankSections(
	question: number[],
	sections: DocSection[],
	vectors: number[][]
): RankedSection[] {
	const ranked = sections
		.map((s, i) => ({ ...s, score: cosine(question, vectors[i]) + (s.fromPost ? POST_BOOST : 0) }))
		.sort((a, b) => b.score - a.score);
	const out: RankedSection[] = [];
	let chars = 0;
	for (const s of ranked) {
		if (out.length >= TOP_SECTIONS) break;
		if (chars + s.text.length > MAX_RESULT_CHARS && out.length > 0) continue;
		out.push(s);
		chars += s.text.length;
	}
	return out;
}

/** Null when the write-ups couldn't be loaded or embedded. */
export async function explainHuntBot(question: string): Promise<RankedSection[] | null> {
	try {
		const idx = await getIndex();
		if (!idx) return null;
		const vector = await getEmbeddings().embedQuery(question);
		return rankSections(vector, idx.sections, idx.vectors);
	} catch (error) {
		console.warn('[HuntBot tools] explain_huntbot failed', {
			error: describeError(error)
		});
		return null;
	}
}
