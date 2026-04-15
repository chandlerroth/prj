import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runAuth } from "./auth.ts";
import { _resetTokenCache } from "../lib/gh-api.ts";

const origHome = process.env.HOME;
const origExit = process.exit;
const origStderrWrite = process.stderr.write;
const origConsoleError = console.error;
const origFetch = globalThis.fetch;

let home: string;
let exitCode: number | null;
let stderr: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "prj-auth-"));
  process.env.HOME = home;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  _resetTokenCache();
  exitCode = null;
  stderr = "";
  // @ts-expect-error stub
  process.exit = (code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`__exit:${code}`);
  };
  // @ts-expect-error stub
  process.stderr.write = (chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  };
  console.error = (...args: unknown[]) => {
    stderr += args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n";
  };
});

afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  process.exit = origExit;
  process.stderr.write = origStderrWrite;
  console.error = origConsoleError;
  globalThis.fetch = origFetch;
  _resetTokenCache();
});

function configPath() {
  return join(home, ".config", "prj", "config.json");
}

function writeGoodToken(token: string) {
  mkdirSync(join(home, ".config", "prj"), { recursive: true });
  writeFileSync(configPath(), JSON.stringify({ githubToken: token }));
}

test("prj auth help prints usage and does not touch config", async () => {
  writeGoodToken("ghp_originalgoodtoken");
  await runAuth("help", undefined);
  expect(stderr).toContain("prj auth — Manage your GitHub token");
  // Original token must still be present.
  expect(JSON.parse(readFileSync(configPath(), "utf8"))).toEqual({ githubToken: "ghp_originalgoodtoken" });
});

test("prj auth <garbage> rejects without clobbering existing token", async () => {
  writeGoodToken("ghp_originalgoodtoken");
  await expect(runAuth("not-a-token", undefined)).rejects.toThrow("__exit:1");
  expect(exitCode).toBe(1);
  // Config untouched.
  expect(JSON.parse(readFileSync(configPath(), "utf8"))).toEqual({ githubToken: "ghp_originalgoodtoken" });
});

test("prj auth <bad-but-tokenish> verifies first and does NOT persist on 401", async () => {
  writeGoodToken("ghp_originalgoodtoken");
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ message: "Bad credentials" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  await expect(
    runAuth("ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", undefined),
  ).rejects.toThrow("__exit:1");
  expect(exitCode).toBe(1);
  // Crucially: original token preserved.
  expect(JSON.parse(readFileSync(configPath(), "utf8"))).toEqual({ githubToken: "ghp_originalgoodtoken" });
  expect(stderr).toContain("left untouched");
});

test("prj auth <good-token> verifies and persists", async () => {
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = url.toString();
    if (u.endsWith("/user")) {
      return new Response(JSON.stringify({ login: "alice" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;

  await runAuth("ghp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", undefined);
  expect(exitCode).toBe(null); // didn't exit
  expect(existsSync(configPath())).toBe(true);
  expect(JSON.parse(readFileSync(configPath(), "utf8"))).toEqual({
    githubToken: "ghp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  });
  expect(stderr).toContain("Authenticated as alice");
});

test("prj auth logout removes the saved token", async () => {
  writeGoodToken("ghp_originalgoodtoken");
  await runAuth("logout", undefined);
  expect(JSON.parse(readFileSync(configPath(), "utf8"))).toEqual({});
});

test("prj auth --non-interactive status reports unauthenticated without a token", async () => {
  let stdout = "";
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    stdout += args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n";
  };
  try {
    await runAuth(undefined, undefined, true, "status");
  } finally {
    console.log = origLog;
  }
  expect(JSON.parse(stdout)).toEqual({
    success: true,
    action: "status",
    authenticated: false,
    user: null,
    tokenSource: null,
  });
});

test("prj auth --non-interactive status emits authenticated env token source", async () => {
  process.env.GITHUB_TOKEN = "ghp_cccccccccccccccccccccccccccccccc";
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (url.toString().endsWith("/user")) {
      return new Response(JSON.stringify({ login: "alice" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;

  let stdout = "";
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    stdout += args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n";
  };
  try {
    await runAuth(undefined, undefined, true, "status");
  } finally {
    console.log = origLog;
  }
  expect(JSON.parse(stdout)).toEqual({
    success: true,
    action: "status",
    authenticated: true,
    user: "alice",
    tokenSource: "env",
  });
});

test("prj auth --non-interactive login persists a verified token", async () => {
  let stdout = "";
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    stdout += args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n";
  };
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (url.toString().endsWith("/user")) {
      return new Response(JSON.stringify({ login: "alice" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;

  try {
    await runAuth(undefined, "ghp_dddddddddddddddddddddddddddddddd", true, "login");
  } finally {
    console.log = origLog;
  }
  expect(JSON.parse(stdout)).toEqual({
    success: true,
    action: "login",
    user: "alice",
  });
  expect(JSON.parse(readFileSync(configPath(), "utf8"))).toEqual({
    githubToken: "ghp_dddddddddddddddddddddddddddddddd",
  });
});

test("prj auth --non-interactive rejects unknown actions", async () => {
  let stdout = "";
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    stdout += args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n";
  };
  try {
    await expect(runAuth(undefined, undefined, true, "wat")).rejects.toThrow("__exit:1");
  } finally {
    console.log = origLog;
  }
  expect(exitCode).toBe(1);
  const out = JSON.parse(stdout);
  expect(out.success).toBe(false);
  expect(out.error).toContain("Unknown action");
});
