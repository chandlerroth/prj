import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { tmpdir } from "os";

const cloneCalls: Array<{ url: string; target: string }> = [];
const executeGitCalls: Array<{ args: string[]; cwd?: string }> = [];
const deleteRepoCalls: Array<{ owner: string; name: string }> = [];
let cloneShouldSucceed = true;
let createShouldThrow: Error | null = null;
let currentUser = "alice";
let currentCwdGitRepo = false;
let currentRemoteUrl = "";
let currentBranch = "";
let remoteAddExitCode = 0;
let pushExitCode = 0;
let deleteRepoShouldSucceed = true;
let existingGitRepos = new Set<string>();

mock.module("../lib/git.ts", () => ({
  cloneRepo: async (url: string, target: string) => {
    cloneCalls.push({ url, target });
    if (cloneShouldSucceed) mkdirSync(join(target, ".git"), { recursive: true });
    return cloneShouldSucceed;
  },
  isGitRepo: async (path: string) => existingGitRepos.has(path) || (currentCwdGitRepo && path === process.cwd()),
  executeGit: async (args: string[], cwd?: string) => {
    executeGitCalls.push({ args, cwd });
    if (args[0] === "remote" && args[1] === "add") return { exitCode: remoteAddExitCode };
    if (args[0] === "push") return { exitCode: pushExitCode };
    return { exitCode: 0 };
  },
  executeGitWithOutput: async (args: string[]) => {
    if (args[0] === "remote" && args[1] === "get-url") {
      return { exitCode: currentRemoteUrl ? 0 : 1, stdout: currentRemoteUrl, stderr: "" };
    }
    if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "HEAD") {
      return { exitCode: 0, stdout: currentBranch, stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  },
}));

mock.module("../lib/gh-api.ts", () => ({
  getCurrentUser: async () => currentUser,
  createRepo: async (owner: string, name: string) => {
    if (createShouldThrow) throw createShouldThrow;
    return {
      nameWithOwner: `${owner}/${name}`,
      sshUrl: `git@github.com:${owner}/${name}.git`,
      htmlUrl: `https://github.com/${owner}/${name}`,
    };
  },
  deleteRepo: async (owner: string, name: string) => {
    deleteRepoCalls.push({ owner, name });
    return deleteRepoShouldSucceed;
  },
  _resetTokenCache: () => {},
}));

import { runCreate } from "./create.ts";

const origHome = process.env.HOME;
const origExit = process.exit;
const origLog = console.log;
const origErr = console.error;
const origCwd = process.cwd();
let stdout = "";
let stderr = "";
let exitCode: number | null = null;

beforeEach(() => {
  cloneCalls.length = 0;
  executeGitCalls.length = 0;
  deleteRepoCalls.length = 0;
  cloneShouldSucceed = true;
  createShouldThrow = null;
  currentUser = "alice";
  currentCwdGitRepo = false;
  currentRemoteUrl = "";
  currentBranch = "";
  remoteAddExitCode = 0;
  pushExitCode = 0;
  deleteRepoShouldSucceed = true;
  existingGitRepos = new Set();
  stdout = "";
  stderr = "";
  exitCode = null;
  const home = mkdtempSync(join(tmpdir(), "prj-create-"));
  process.env.HOME = home;
  mkdirSync(join(home, "Projects"), { recursive: true });
  // @ts-expect-error stub
  process.exit = (code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`__exit:${code}`);
  };
  console.log = (...args: unknown[]) => {
    stdout += args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n";
  };
  console.error = (...args: unknown[]) => {
    stderr += args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n";
  };
});

afterEach(() => {
  console.log = origLog;
  console.error = origErr;
  process.exit = origExit;
  process.chdir(origCwd);
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
});

test("create --non-interactive --name=my-app uses current user as owner", async () => {
  await runCreate("my-app", true);
  const out = JSON.parse(stdout);
  expect(out.success).toBe(true);
  expect(out.nameWithOwner).toBe("alice/my-app");
  expect(out.sshUrl).toBe("git@github.com:alice/my-app.git");
  expect(cloneCalls).toHaveLength(1);
});

test("create --non-interactive --name=org/repo uses explicit owner", async () => {
  await runCreate("acme/widget", true);
  const out = JSON.parse(stdout);
  expect(out.success).toBe(true);
  expect(out.nameWithOwner).toBe("acme/widget");
});

test("create --non-interactive without a name fails with JSON error", async () => {
  await expect(runCreate(undefined, true)).rejects.toThrow("__exit:1");
  expect(exitCode).toBe(1);
  expect(JSON.parse(stdout).success).toBe(false);
});

test("create --non-interactive surfaces createRepo failure as JSON error", async () => {
  createShouldThrow = new Error("name already exists on this account");
  await expect(runCreate("dup", true)).rejects.toThrow("__exit:1");
  const out = JSON.parse(stdout);
  expect(out.success).toBe(false);
  expect(out.error).toContain("name already exists");
});

test("create --non-interactive rolls back when local clone fails", async () => {
  cloneShouldSucceed = false;
  await expect(runCreate("acme/widget", true)).rejects.toThrow("__exit:1");
  const out = JSON.parse(stdout);
  expect(out.success).toBe(false);
  expect(out.error).toContain("Failed to clone");
  // Rollback metadata is included so agents can detect what happened.
  expect(out).toHaveProperty("rollback");
});

test("create --non-interactive rejects invalid dash-prefixed names", async () => {
  await expect(runCreate("-bad", true)).rejects.toThrow("__exit:1");
  const out = JSON.parse(stdout);
  expect(out.success).toBe(false);
  expect(out.error).toContain("Invalid repo name");
});

test("create --non-interactive '.' rejects a non-git cwd", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "prj-create-cwd-"));
  process.chdir(cwd);

  await expect(runCreate(".", true)).rejects.toThrow("__exit:1");
  const out = JSON.parse(stdout);
  expect(out.success).toBe(false);
  expect(out.error).toContain("Current directory is not a git repo");
});

test("create --non-interactive '.' rejects when origin already exists", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "prj-create-cwd-"));
  process.chdir(cwd);
  currentCwdGitRepo = true;
  currentRemoteUrl = "git@github.com:alice/existing.git";

  await expect(runCreate(".", true)).rejects.toThrow("__exit:1");
  const out = JSON.parse(stdout);
  expect(out.success).toBe(false);
  expect(out.error).toContain("Remote 'origin' already set");
});

test("create --non-interactive '.' rolls back when adding origin fails", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "prj-create-cwd-"));
  process.chdir(cwd);
  currentCwdGitRepo = true;
  remoteAddExitCode = 1;

  await expect(runCreate(".", true)).rejects.toThrow("__exit:1");
  const out = JSON.parse(stdout);
  expect(out.success).toBe(false);
  expect(out.error).toContain("Failed to add remote origin");
  expect(out.rollback).toContain("deleted alice/");
  expect(deleteRepoCalls).toEqual([{ owner: "alice", name: basename(cwd) }]);
});

test("create --non-interactive '.' rolls back when initial push fails", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "prj-create-cwd-"));
  process.chdir(cwd);
  currentCwdGitRepo = true;
  currentBranch = "main";
  pushExitCode = 1;

  await expect(runCreate(".", true)).rejects.toThrow("__exit:1");
  const out = JSON.parse(stdout);
  expect(out.success).toBe(false);
  expect(out.error).toContain("Failed to push main");
  expect(out.rollback).toContain("deleted alice/");
  expect(executeGitCalls.some((c) => c.args.join(" ") === "remote remove origin")).toBe(true);
});

test("create --non-interactive '.' refuses to move into an existing target path", async () => {
  const home = process.env.HOME!;
  const cwd = mkdtempSync(join(tmpdir(), "prj-create-cwd-"));
  const target = join(home, "Projects", "alice", basename(cwd).toLowerCase());
  process.chdir(cwd);
  currentCwdGitRepo = true;
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, ".gitkeep"), "");

  await expect(runCreate(".", true)).rejects.toThrow("__exit:1");
  const out = JSON.parse(stdout);
  expect(out.success).toBe(false);
  expect(out.error).toContain("Refusing to move");
  expect(out.rollback).toContain("deleted alice/");
  expect(existsSync(cwd)).toBe(true);
});

test("create --non-interactive '.' moves the cwd into ~/Projects on success", async () => {
  const home = process.env.HOME!;
  const cwd = mkdtempSync(join(tmpdir(), "prj-create-cwd-"));
  const repoName = basename(cwd).toLowerCase();
  process.chdir(cwd);
  currentCwdGitRepo = true;
  currentBranch = "main";

  await runCreate(".", true);
  const out = JSON.parse(stdout);
  expect(out.success).toBe(true);
  expect(out.fullPath).toBe(join(home, "Projects", "alice", repoName));
  expect(existsSync(out.fullPath)).toBe(true);
  expect(existsSync(cwd)).toBe(false);
});
