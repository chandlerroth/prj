import { test, expect, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  executeGitWithOutput,
  executeGitQuiet,
  isGitRepo,
  getCurrentBranch,
  getChangedFilesCount,
  getStashCount,
  branchExists,
} from "./git.ts";
import { getRepoStatus, parsePorcelainV2 } from "./status.ts";

// Real-git integration tests. Skipped if `git` is unavailable.
let repoDir: string;
let hasGit = true;

beforeAll(async () => {
  try {
    const v = Bun.spawn(["git", "--version"], { stdout: "ignore", stderr: "ignore" });
    await v.exited;
    hasGit = v.exitCode === 0;
  } catch {
    hasGit = false;
  }
  if (!hasGit) return;

  repoDir = mkdtempSync(join(tmpdir(), "prj-git-"));
  // Use -c to avoid touching the user's git config (e.g. user.email).
  const init = Bun.spawn(
    [
      "git",
      "-c", "init.defaultBranch=main",
      "-c", "user.email=test@example.com",
      "-c", "user.name=Test",
      "init", "-q", repoDir,
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  await init.exited;
  // Configure local user so commits work.
  await Bun.spawn(["git", "-C", repoDir, "config", "user.email", "test@example.com"]).exited;
  await Bun.spawn(["git", "-C", repoDir, "config", "user.name", "Test"]).exited;
  // Initial commit.
  writeFileSync(join(repoDir, "README.md"), "hi\n");
  await Bun.spawn(["git", "-C", repoDir, "add", "README.md"], { stdout: "ignore" }).exited;
  await Bun.spawn(
    ["git", "-C", repoDir, "commit", "-q", "-m", "init"],
    { stdout: "ignore", stderr: "ignore" },
  ).exited;
});

test("isGitRepo true for a real repo, false for tmpdir", async () => {
  if (!hasGit) return;
  expect(await isGitRepo(repoDir)).toBe(true);
  const empty = mkdtempSync(join(tmpdir(), "prj-empty-"));
  expect(await isGitRepo(empty)).toBe(false);
});

test("getCurrentBranch returns the initial branch", async () => {
  if (!hasGit) return;
  const b = await getCurrentBranch(repoDir);
  // Could be "main" or "master" depending on git defaults; both fine.
  expect(b === "main" || b === "master").toBe(true);
});

test("getChangedFilesCount counts dirty + untracked", async () => {
  if (!hasGit) return;
  // Clean baseline.
  expect(await getChangedFilesCount(repoDir)).toBe(0);
  // Modify tracked file.
  writeFileSync(join(repoDir, "README.md"), "modified\n");
  // Add an untracked file.
  writeFileSync(join(repoDir, "new.txt"), "x\n");
  expect(await getChangedFilesCount(repoDir)).toBe(2);
});

test("executeGitWithOutput surfaces stdout and exit code", async () => {
  if (!hasGit) return;
  const r = await executeGitWithOutput(["rev-parse", "--show-toplevel"], repoDir);
  expect(r.exitCode).toBe(0);
  // realpath/symlinks on macOS tmpdir can differ; just check it ends with the basename.
  expect(r.stdout).toContain(repoDir.split("/").pop()!);
});

test("executeGitQuiet returns nonzero on bad command", async () => {
  if (!hasGit) return;
  const r = await executeGitQuiet(["this-is-not-a-git-command"], repoDir);
  expect(r.exitCode).not.toBe(0);
});

test("branchExists detects HEAD and rejects garbage", async () => {
  if (!hasGit) return;
  expect(await branchExists(repoDir, "HEAD")).toBe(true);
  expect(await branchExists(repoDir, "definitely-not-a-branch")).toBe(false);
});

test("getStashCount counts entries", async () => {
  if (!hasGit) return;
  // Make a dirty change first.
  writeFileSync(join(repoDir, "README.md"), "stash me\n");
  await Bun.spawn(["git", "-C", repoDir, "stash", "-q"], { stdout: "ignore", stderr: "ignore" }).exited;
  expect(await getStashCount(repoDir)).toBeGreaterThanOrEqual(1);
  // Cleanup so subsequent tests aren't surprised.
  await Bun.spawn(["git", "-C", repoDir, "stash", "drop", "-q"], { stdout: "ignore", stderr: "ignore" }).exited;
});

test("getRepoStatus end-to-end against a real repo via porcelain v2", async () => {
  if (!hasGit) return;
  // Self-contained: ensure we have at least one tracked-modification AND
  // one untracked file regardless of cross-test state.
  writeFileSync(join(repoDir, "README.md"), "porcelain check\n");
  writeFileSync(join(repoDir, "untracked.txt"), "x\n");

  const repo = {
    username: "tmp",
    repoName: "repo",
    fullPath: repoDir,
    displayName: "tmp/repo",
  };
  const status = await getRepoStatus(repo);
  expect(status.installed).toBe(true);
  expect(status.branch === "main" || status.branch === "master").toBe(true);
  expect(status.changes).toBeGreaterThanOrEqual(2);
});

test("getRepoStatus({ fetch: true }) survives an unreachable remote", async () => {
  if (!hasGit) return;
  // Point origin at a nonexistent local path so `git fetch` fails fast (no DNS,
  // no network). The status read should still succeed.
  await Bun.spawn(
    ["git", "-C", repoDir, "remote", "add", "origin", "file:///nonexistent/prj-test.git"],
    { stdout: "ignore", stderr: "ignore" },
  ).exited;

  try {
    const repo = {
      username: "tmp",
      repoName: "repo",
      fullPath: repoDir,
      displayName: "tmp/repo",
    };
    const status = await getRepoStatus(repo, { fetch: true });
    expect(status.installed).toBe(true);
    expect(status.branch === "main" || status.branch === "master").toBe(true);
  } finally {
    await Bun.spawn(
      ["git", "-C", repoDir, "remote", "remove", "origin"],
      { stdout: "ignore", stderr: "ignore" },
    ).exited;
  }
});

test("parsePorcelainV2 ignores lines it doesn't recognize", () => {
  const r = parsePorcelainV2("garbage\n# branch.head dev\nblah\n");
  expect(r.branch).toBe("dev");
  expect(r.changes).toBe(0);
});
