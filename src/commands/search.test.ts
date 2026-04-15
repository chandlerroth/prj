import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let mockResults: Array<{ nameWithOwner: string; description: string | null }> = [];
let searchShouldThrow: Error | null = null;
let selectedValue: string | null = null;
const cloneCalls: Array<{ url: string; target: string }> = [];
let cloneShouldSucceed = true;
let existingRepos = new Set<string>();

mock.module("../lib/gh-api.ts", () => ({
  fetchGhRepos: async () => mockResults,
  searchRepos: async () => {
    if (searchShouldThrow) throw searchShouldThrow;
    return mockResults;
  },
  _resetTokenCache: () => {},
}));

mock.module("../lib/prompt.ts", () => ({
  select: async () => selectedValue,
}));

mock.module("../lib/git.ts", () => ({
  cloneRepo: async (url: string, target: string) => {
    cloneCalls.push({ url, target });
    return cloneShouldSucceed;
  },
  isGitRepo: async (path: string) => existingRepos.has(path),
}));

import { runSearch } from "./search.ts";

const origHome = process.env.HOME;
const origExit = process.exit;
const origLog = console.log;
const origErr = console.error;
const origStderrWrite = process.stderr.write;
let stdout = "";
let stderr = "";
let exitCode: number | null = null;

beforeEach(() => {
  mockResults = [];
  searchShouldThrow = null;
  selectedValue = null;
  cloneCalls.length = 0;
  cloneShouldSucceed = true;
  existingRepos = new Set();
  stdout = "";
  stderr = "";
  exitCode = null;
  const home = mkdtempSync(join(tmpdir(), "prj-search-"));
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
  process.stderr.write = origStderrWrite;
  process.exit = origExit;
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
});

test("search --non-interactive emits JSON results with cloned flag", async () => {
  // Pre-clone alice/one so we can verify the cloned flag is set.
  const home = process.env.HOME!;
  const clonedPath = join(home, "Projects", "alice", "one");
  mkdirSync(join(clonedPath, ".git"), { recursive: true });

  mockResults = [
    { nameWithOwner: "alice/one", description: "first" },
    { nameWithOwner: "bob/two", description: null },
  ];

  await runSearch("foo", true);
  const out = JSON.parse(stdout);
  expect(out).toHaveLength(2);
  const aliceEntry = out.find((r: { nameWithOwner: string }) => r.nameWithOwner === "alice/one");
  const bobEntry = out.find((r: { nameWithOwner: string }) => r.nameWithOwner === "bob/two");
  expect(aliceEntry.cloned).toBe(true);
  expect(bobEntry.cloned).toBe(false);
});

test("search --non-interactive surfaces fetch errors via process.exit", async () => {
  searchShouldThrow = new Error("rate limited");
  await expect(runSearch("anything", true)).rejects.toThrow("__exit:1");
  expect(exitCode).toBe(1);
});

test("search --non-interactive without query uses fetchGhRepos", async () => {
  mockResults = [{ nameWithOwner: "alice/one", description: null }];
  await runSearch(undefined, true);
  expect(JSON.parse(stdout)).toEqual([
    { nameWithOwner: "alice/one", description: null, cloned: false },
  ]);
});

test("search reports no matching repos", async () => {
  await runSearch("nope", true);
  expect(stderr).toContain('No repos matching "nope".');
});

test("search interactive prints path for an already-cloned repo", async () => {
  const home = process.env.HOME!;
  const repoPath = join(home, "Projects", "alice", "one");
  mkdirSync(join(repoPath, ".git"), { recursive: true });
  mockResults = [{ nameWithOwner: "Alice/One", description: "first" }];
  selectedValue = "Alice/One";

  await runSearch("one", false);
  expect(stdout.trim()).toBe(repoPath);
  expect(cloneCalls).toHaveLength(0);
});

test("search interactive clones an uncloned repo", async () => {
  const home = process.env.HOME!;
  mockResults = [{ nameWithOwner: "bob/two", description: null }];
  selectedValue = "bob/two";

  await runSearch("two", false);
  expect(cloneCalls).toEqual([
    { url: "https://github.com/bob/two.git", target: join(home, "Projects", "bob", "two") },
  ]);
  expect(stdout.trim()).toBe(join(home, "Projects", "bob", "two"));
});

test("search interactive exits on clone failure", async () => {
  mockResults = [{ nameWithOwner: "bob/two", description: null }];
  selectedValue = "bob/two";
  cloneShouldSucceed = false;

  await expect(runSearch("two", false)).rejects.toThrow("__exit:1");
  expect(exitCode).toBe(1);
  expect(stderr).toContain("Failed to clone bob/two");
});
