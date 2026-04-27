import { test, expect } from "bun:test";
import { parsePorcelainV2, formatStatusHint, type RepoStatus } from "./status.ts";

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("parsePorcelainV2 parses branch + ahead/behind + changes", () => {
  const out = [
    "# branch.oid abcdef",
    "# branch.head main",
    "# branch.upstream origin/main",
    "# branch.ab +2 -3",
    "1 .M N... 100644 100644 100644 aaa bbb file1.ts",
    "1 M. N... 100644 100644 100644 aaa bbb file2.ts",
    "? untracked.ts",
  ].join("\n");
  const r = parsePorcelainV2(out);
  expect(r.branch).toBe("main");
  expect(r.ahead).toBe(2);
  expect(r.behind).toBe(3);
  expect(r.changes).toBe(3);
});

test("parsePorcelainV2 handles clean repo with no upstream", () => {
  const r = parsePorcelainV2("# branch.oid abc\n# branch.head main\n");
  expect(r.branch).toBe("main");
  expect(r.ahead).toBe(0);
  expect(r.behind).toBe(0);
  expect(r.changes).toBe(0);
});

test("parsePorcelainV2 maps detached HEAD to null branch", () => {
  const r = parsePorcelainV2("# branch.head (detached)\n");
  expect(r.branch).toBeNull();
});

test("formatStatusHint shows clean for installed repo with no changes", () => {
  const s: RepoStatus = {
    displayName: "u/r", branch: "main",
    ahead: 0, behind: 0, changes: 0, stashes: 0, installed: true,
  };
  expect(stripAnsi(formatStatusHint(s))).toBe("git:(main) [✓ clean]");
});

test("formatStatusHint shows ahead/behind/changes", () => {
  const s: RepoStatus = {
    displayName: "u/r", branch: "main",
    ahead: 1, behind: 2, changes: 3, stashes: 0, installed: true,
  };
  expect(stripAnsi(formatStatusHint(s))).toBe("git:(main) [2↓ 1↑ 3 changes]");
});

test("formatStatusHint shows stashes separately from changes", () => {
  const cleanWithStash: RepoStatus = {
    displayName: "u/r", branch: "main",
    ahead: 0, behind: 0, changes: 0, stashes: 1, installed: true,
  };
  expect(stripAnsi(formatStatusHint(cleanWithStash))).toBe("git:(main) [1 stash]");

  const both: RepoStatus = {
    displayName: "u/r", branch: "main",
    ahead: 0, behind: 0, changes: 2, stashes: 3, installed: true,
  };
  expect(stripAnsi(formatStatusHint(both))).toBe("git:(main) [2 changes 3 stashes]");
});
