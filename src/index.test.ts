import { test, expect } from "bun:test";

async function runCli(args: string[]) {
  const proc = Bun.spawn(["bun", "run", "src/index.ts", ...args], {
    cwd: import.meta.dir + "/..",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  return { code: proc.exitCode ?? 1, stdout, stderr };
}

test("cli prints top-level help", async () => {
  const r = await runCli(["--help"]);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("prj - Project Manager");
  expect(r.stdout).toContain("rm [project|path|.]");
  expect(r.stdout).not.toContain("[index");
});

test("cli prints version", async () => {
  const r = await runCli(["--version"]);
  expect(r.code).toBe(0);
  expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
});

test("cli supports alias help for list", async () => {
  const r = await runCli(["l", "--help"]);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("prj list");
  expect(r.stdout).toContain("--non-interactive");
});

test("cli prints rm help without index-based usage", async () => {
  const r = await runCli(["rm", "--help"]);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("prj rm <user/repo>");
  expect(r.stdout).not.toContain("1-based index");
});

test("cli rejects unknown commands", async () => {
  const r = await runCli(["wat"]);
  expect(r.code).toBe(1);
  expect(r.stderr).toContain("Unknown command: wat");
});
