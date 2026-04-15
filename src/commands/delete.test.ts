import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, mkdirSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Other test files mock `../lib/git.ts` via `mock.module`, and that registry
// is global. Re-install real-passthrough implementations here so delete.ts
// (which we exercise end-to-end with real git repos) sees actual git output.
async function spawnGit(args: string[], cwd?: string, capture = false) {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: capture ? "pipe" : "ignore",
    stderr: capture ? "pipe" : "ignore",
  });
  const stdout = capture ? (await new Response(proc.stdout).text()).trim() : "";
  await proc.exited;
  return { exitCode: proc.exitCode ?? 1, stdout, stderr: "" };
}
mock.module("../lib/git.ts", () => ({
  isGitRepo: async (path: string) => {
    const proc = Bun.spawn(["test", "-d", `${path}/.git`]);
    await proc.exited;
    return proc.exitCode === 0;
  },
  getChangedFilesCount: async (cwd: string) => {
    const r = await spawnGit(["status", "--porcelain"], cwd, true);
    return r.exitCode === 0 && r.stdout ? r.stdout.split("\n").filter(Boolean).length : 0;
  },
  getUpstream: async (cwd: string) => {
    const r = await spawnGit(["rev-parse", "--abbrev-ref", "@{u}"], cwd, true);
    return r.exitCode === 0 ? r.stdout : null;
  },
  getAheadBehind: async () => ({ ahead: 0, behind: 0 }),
  getStashCount: async () => 0,
}));

import { runDelete } from "./delete.ts";

const origHome = process.env.HOME;
const origExit = process.exit;
const origLog = console.log;
const origErr = console.error;
const origStderrWrite = process.stderr.write;
let stdout = "";
let stderr = "";
let exitCode: number | null = null;

async function makeRepo(dir: string, dirty = false) {
  mkdirSync(dir, { recursive: true });
  await Bun.spawn(["git", "init", "-q"], { cwd: dir, stdout: "ignore", stderr: "ignore" }).exited;
  await Bun.spawn(["git", "config", "user.email", "t@t.t"], { cwd: dir, stdout: "ignore", stderr: "ignore" }).exited;
  await Bun.spawn(["git", "config", "user.name", "t"], { cwd: dir, stdout: "ignore", stderr: "ignore" }).exited;
  writeFileSync(join(dir, "README.md"), "hi");
  await Bun.spawn(["git", "add", "."], { cwd: dir, stdout: "ignore", stderr: "ignore" }).exited;
  await Bun.spawn(["git", "commit", "-q", "-m", "init"], { cwd: dir, stdout: "ignore", stderr: "ignore" }).exited;
  if (dirty) writeFileSync(join(dir, "README.md"), "changed");
}

beforeEach(() => {
  stdout = "";
  stderr = "";
  exitCode = null;
  const home = mkdtempSync(join(tmpdir(), "prj-del-"));
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
  // @ts-expect-error stub
  process.stderr.write = (chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  };
});

afterEach(() => {
  console.log = origLog;
  console.error = origErr;
  process.exit = origExit;
  process.stderr.write = origStderrWrite;
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
});

test("delete --non-interactive --force removes a clean repo", async () => {
  const home = process.env.HOME!;
  const dir = join(home, "Projects", "alice", "one");
  await makeRepo(dir);

  await runDelete("alice/one", true, true);
  expect(existsSync(dir)).toBe(false);
});

test("delete --non-interactive without --force refuses a dirty repo", async () => {
  const home = process.env.HOME!;
  const dir = join(home, "Projects", "alice", "one");
  await makeRepo(dir, true);

  await expect(runDelete("alice/one", true, false)).rejects.toThrow("__exit:1");
  expect(exitCode).toBe(1);
  expect(existsSync(dir)).toBe(true);
});

test("delete --non-interactive with missing project errors", async () => {
  const home = process.env.HOME!;
  await makeRepo(join(home, "Projects", "alice", "one"));

  await expect(runDelete("alice/two", true, false)).rejects.toThrow("__exit:1");
  expect(exitCode).toBe(1);
});
