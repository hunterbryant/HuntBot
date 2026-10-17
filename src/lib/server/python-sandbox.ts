import { env } from '$env/dynamic/private';
import { Sandbox, type NetworkPolicy } from '@vercel/sandbox';

const MAX_OUTPUT_CHARS = 4000;

export type PythonRunResult =
	| { ok: true; stdout: string; stderr: string; exitCode: number }
	| { ok: false; error: string };

/**
 * Whether a Vercel Sandbox can be created here. On Vercel the SDK authenticates with
 * the function's OIDC token; locally it needs VERCEL_OIDC_TOKEN (`vercel env pull`).
 * Without either it would start an interactive device-login flow and hang the turn.
 */
export function isSandboxAvailable(): boolean {
	return env.VERCEL === '1' || Boolean(env.VERCEL_OIDC_TOKEN);
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
	if (!isSandboxAvailable()) return { ok: false, error: 'Code execution is not configured.' };

	let sandbox: Sandbox | null = null;
	try {
		sandbox = await Sandbox.create({
			image: 'vercel/sandbox/python:3.14',
			networkPolicy,
			resources: { vcpus: 1 },
			timeout: 60_000,
			signal: AbortSignal.timeout(15_000)
		});
		await sandbox.writeFiles([...files, { path: 'analysis.py', content: code }]);
		const result = await sandbox.runCommand('python3', ['analysis.py'], { timeoutMs: 30_000 });
		const [stdout, stderr] = await Promise.all([result.stdout(), result.stderr()]);
		return { ok: true, stdout: clip(stdout), stderr: clip(stderr), exitCode: result.exitCode };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn('[HuntBot sandbox] Python run failed', { error: message });
		return { ok: false, error: message };
	} finally {
		sandbox?.stop().catch(() => {});
	}
}
