import { env } from '$env/dynamic/private';
import { waitUntil } from '@vercel/functions';
import { Sandbox, type NetworkPolicy } from '@vercel/sandbox';
import { warnOnce } from './warn-once';

const MAX_OUTPUT_CHARS = 4000;
// The sandbox's own lifetime. If a create call is abandoned after the VM has started we
// never get a handle to stop it, so this is also the longest such a leak can run.
const SANDBOX_TIMEOUT_MS = 50_000;

export type PythonRunResult =
	| {
			ok: true;
			stdout: string;
			stderr: string;
			exitCode: number;
			/** Bytes the script wrote to stdout before clipping. */
			stdoutBytes: number;
			/** Sandbox startup, and write-files plus the script itself. */
			createMs: number;
			runMs: number;
	  }
	| {
			ok: false;
			error: string;
			/** Where it failed: starting the sandbox, or running the script in it. */
			phase: 'create' | 'run';
			ms: number;
	  };

/**
 * Whether a Vercel Sandbox can be created here. On Vercel the SDK authenticates with
 * the function's OIDC token; locally it needs VERCEL_OIDC_TOKEN (`vercel env pull`).
 * Without either it would start an interactive device-login flow and hang the turn.
 */
export function isSandboxAvailable(): boolean {
	const available = env.VERCEL === '1' || Boolean(env.VERCEL_OIDC_TOKEN);
	if (!available) {
		warnOnce(
			'sandbox-unavailable',
			'[HuntBot sandbox] Code execution is off: not running on Vercel and VERCEL_OIDC_TOKEN is unset (run `vercel env pull` locally)'
		);
	}
	return available;
}

const clip = (s: string) =>
	s.length > MAX_OUTPUT_CHARS ? `${s.slice(0, MAX_OUTPUT_CHARS)}\n[...truncated]` : s;

/**
 * Runs model-written Python in a throwaway Vercel Sandbox with `files` preloaded in
 * the working directory, and stops the sandbox as soon as the script exits. Network
 * access is denied unless `networkPolicy` opens something specific.
 */
export async function runPython(
	code: string,
	files: { path: string; content: string }[],
	{ networkPolicy = 'deny-all' }: { networkPolicy?: NetworkPolicy } = {}
): Promise<PythonRunResult> {
	if (!isSandboxAvailable()) {
		return { ok: false, error: 'Code execution is not configured.', phase: 'create', ms: 0 };
	}

	let sandbox: Sandbox | null = null;
	let phase: 'create' | 'run' = 'create';
	const t0 = performance.now();
	try {
		sandbox = await Sandbox.create({
			image: 'vercel/sandbox/python:3.14',
			networkPolicy,
			resources: { vcpus: 1 },
			timeout: SANDBOX_TIMEOUT_MS,
			signal: AbortSignal.timeout(20_000)
		});
		const createMs = Math.round(performance.now() - t0);
		phase = 'run';
		await sandbox.writeFiles([...files, { path: 'analysis.py', content: code }]);
		const result = await sandbox.runCommand('python3', ['analysis.py'], { timeoutMs: 30_000 });
		const [stdout, stderr] = await Promise.all([result.stdout(), result.stderr()]);
		return {
			ok: true,
			stdout: clip(stdout),
			stderr: clip(stderr),
			exitCode: result.exitCode,
			stdoutBytes: Buffer.byteLength(stdout),
			createMs,
			runMs: Math.round(performance.now() - t0) - createMs
		};
	} catch (error) {
		// Logged with the turn's run_id by the caller ([HuntBot training] line).
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
			phase,
			ms: Math.round(performance.now() - t0)
		};
	} finally {
		// Not awaited, so the visitor isn't kept waiting on teardown, but registered with
		// waitUntil so a frozen function can't drop it and leave the sandbox billing.
		if (sandbox) waitUntil(sandbox.stop().catch(() => {}));
	}
}
