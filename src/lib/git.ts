/**
 * Single underlying git runner. Each named export below is a thin variant.
 */
type Mode = "inherit" | "capture" | "quiet";

async function runGit(
  args: string[],
  cwd?: string,
  mode: Mode = "inherit",
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stdio = mode === "inherit" ? "inherit" : mode === "capture" ? "pipe" : "ignore";
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: stdio, stderr: stdio });

  let stdout = "";
  let stderr = "";
  if (mode === "capture") {
    stdout = (await new Response(proc.stdout).text()).trim();
    stderr = (await new Response(proc.stderr).text()).trim();
  }
  await proc.exited;
  return { exitCode: proc.exitCode ?? 1, stdout, stderr };
}

/** Execute git, inheriting stdio (user sees output). */
export async function executeGit(args: string[], cwd?: string): Promise<{ exitCode: number }> {
  const { exitCode } = await runGit(args, cwd, "inherit");
  return { exitCode };
}

/** Execute git, capturing stdout/stderr. */
export async function executeGitWithOutput(
  args: string[],
  cwd?: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return runGit(args, cwd, "capture");
}

/** Execute git silently (no output). */
export async function executeGitQuiet(args: string[], cwd?: string): Promise<{ exitCode: number }> {
  const { exitCode } = await runGit(args, cwd, "quiet");
  return { exitCode };
}

/** Clone a repository. */
export async function cloneRepo(url: string, targetDir: string): Promise<boolean> {
  const { exitCode } = await executeGit(["clone", url, targetDir]);
  return exitCode === 0;
}

/** Fetch from remote. Killed if it takes longer than `timeoutMs` (so a single
 *  unreachable remote can't hang `prj list`) or if `signal` aborts (so background
 *  fetches stop the moment the user picks a repo). The child is `unref`'d so it
 *  can't keep the parent process alive on its own. */
export async function fetch(
  cwd: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<boolean> {
  const proc = Bun.spawn(["git", "fetch"], { cwd, stdout: "ignore", stderr: "ignore" });
  proc.unref();
  const timer = setTimeout(() => proc.kill(), opts.timeoutMs ?? 15000);
  const onAbort = () => proc.kill();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  await proc.exited;
  clearTimeout(timer);
  opts.signal?.removeEventListener("abort", onAbort);
  return proc.exitCode === 0;
}

/** Get current branch name. */
export async function getCurrentBranch(cwd: string): Promise<string | null> {
  const { exitCode, stdout } = await executeGitWithOutput(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  return exitCode === 0 ? stdout : null;
}

/** Get upstream tracking branch. */
export async function getUpstream(cwd: string): Promise<string | null> {
  const { exitCode, stdout } = await executeGitWithOutput(["rev-parse", "--abbrev-ref", "@{u}"], cwd);
  return exitCode === 0 ? stdout : null;
}

/** Get number of commits ahead/behind. */
export async function getAheadBehind(
  cwd: string,
  compareBranch: string,
): Promise<{ ahead: number; behind: number }> {
  const { exitCode, stdout } = await executeGitWithOutput(
    ["rev-list", "--left-right", "--count", `${compareBranch}...HEAD`],
    cwd,
  );
  if (exitCode !== 0) return { ahead: 0, behind: 0 };
  const parts = stdout.split(/\s+/);
  if (parts.length === 2) {
    return { behind: parseInt(parts[0], 10) || 0, ahead: parseInt(parts[1], 10) || 0 };
  }
  return { ahead: 0, behind: 0 };
}

/** Get count of changed files. */
export async function getChangedFilesCount(cwd: string): Promise<number> {
  const { exitCode, stdout } = await executeGitWithOutput(["status", "--porcelain"], cwd);
  if (exitCode !== 0 || !stdout) return 0;
  return stdout.split("\n").filter(Boolean).length;
}

/** Check if a branch exists. */
export async function branchExists(cwd: string, branch: string): Promise<boolean> {
  const { exitCode } = await executeGitQuiet(["rev-parse", "--verify", branch], cwd);
  return exitCode === 0;
}

/** Check if repo directory exists and is a git repo. */
export async function isGitRepo(path: string): Promise<boolean> {
  const proc = Bun.spawn(["test", "-d", `${path}/.git`]);
  await proc.exited;
  return proc.exitCode === 0;
}

/** Get count of stashes. */
export async function getStashCount(cwd: string): Promise<number> {
  const { exitCode, stdout } = await executeGitWithOutput(["stash", "list"], cwd);
  if (exitCode !== 0 || !stdout) return 0;
  return stdout.split("\n").filter(Boolean).length;
}
