import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runList } from "./list.ts";

const origHome = process.env.HOME;
const origLog = console.log;
let stdout = "";

beforeEach(() => {
  stdout = "";
  console.log = (...args: unknown[]) => {
    stdout += args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n";
  };
});

afterEach(() => {
  console.log = origLog;
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
});

test("list --non-interactive returns [] when ~/Projects is empty", async () => {
  const home = mkdtempSync(join(tmpdir(), "prj-list-"));
  process.env.HOME = home;
  mkdirSync(join(home, "Projects"));

  await runList(true);
  expect(JSON.parse(stdout)).toEqual([]);
});

test("list --non-interactive emits an entry per org/repo", async () => {
  const home = mkdtempSync(join(tmpdir(), "prj-list-"));
  process.env.HOME = home;
  // Two real git repos so status checks succeed.
  for (const path of [["alice", "one"], ["bob", "two"]]) {
    const dir = join(home, "Projects", path[0], path[1]);
    mkdirSync(dir, { recursive: true });
    await Bun.spawn(["git", "init", "-q"], { cwd: dir, stdout: "ignore", stderr: "ignore" }).exited;
  }

  await runList(true);
  const out = JSON.parse(stdout);
  expect(Array.isArray(out)).toBe(true);
  expect(out.length).toBe(2);
  expect(out.map((r: { displayName: string }) => r.displayName).sort()).toEqual([
    "alice/one",
    "bob/two",
  ]);
  for (const entry of out) {
    expect(entry).toHaveProperty("fullPath");
    expect(entry).toHaveProperty("installed");
    expect(entry).toHaveProperty("branch");
    expect(entry).toHaveProperty("ahead");
    expect(entry).toHaveProperty("behind");
    expect(entry).toHaveProperty("changes");
    expect(entry).not.toHaveProperty("index");
  }
});

test("list --non-interactive ignores non-git directories", async () => {
  const home = mkdtempSync(join(tmpdir(), "prj-list-"));
  process.env.HOME = home;
  const repoDir = join(home, "Projects", "alice", "one");
  mkdirSync(repoDir, { recursive: true });
  await Bun.spawn(["git", "init", "-q"], { cwd: repoDir, stdout: "ignore", stderr: "ignore" }).exited;
  mkdirSync(join(home, "Projects", "alice", "stale"), { recursive: true });

  await runList(true);
  const out = JSON.parse(stdout);
  expect(out.map((r: { displayName: string }) => r.displayName)).toEqual(["alice/one"]);
});
