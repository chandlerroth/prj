import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolveToken, _resetTokenCache, fetchGhRepos, searchRepos, createRepo, redactToken } from "./gh-api.ts";

const origFetch = globalThis.fetch;
const origToken = process.env.GITHUB_TOKEN;
const origGhToken = process.env.GH_TOKEN;
const origHome = process.env.HOME;

beforeEach(() => {
  _resetTokenCache();
  process.env.GITHUB_TOKEN = "test-token";
  delete process.env.GH_TOKEN;
});

afterEach(() => {
  globalThis.fetch = origFetch;
  if (origToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = origToken;
  if (origGhToken !== undefined) process.env.GH_TOKEN = origGhToken;
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  _resetTokenCache();
});

test("resolveToken reads GITHUB_TOKEN from env", () => {
  expect(resolveToken()).toBe("test-token");
});

test("resolveToken falls back to GH_TOKEN", () => {
  delete process.env.GITHUB_TOKEN;
  process.env.GH_TOKEN = "gh-token";
  _resetTokenCache();
  expect(resolveToken()).toBe("gh-token");
});

test("resolveToken falls back to prj config when env is unset", () => {
  const home = mkdtempSync(join(tmpdir(), "prj-gh-"));
  process.env.HOME = home;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  mkdirSync(join(home, ".config", "prj"), { recursive: true });
  writeFileSync(join(home, ".config", "prj", "config.json"), JSON.stringify({ githubToken: "cfg-token" }));
  _resetTokenCache();
  expect(resolveToken()).toBe("cfg-token");
});

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("fetchGhRepos paginates via Link header and dedupes", async () => {
  let call = 0;
  globalThis.fetch = (async (url: string | URL | Request) => {
    call++;
    const u = url.toString();
    if (call === 1) {
      expect(u).toContain("/user/repos");
      return jsonResponse(
        [
          { full_name: "a/one", description: "x", archived: false, ssh_url: "", html_url: "" },
          { full_name: "a/two", description: null, archived: true, ssh_url: "", html_url: "" },
        ],
        { link: '<https://api.github.com/user/repos?page=2>; rel="next"' }
      );
    }
    return jsonResponse([
      { full_name: "A/one", description: "dup", archived: false, ssh_url: "", html_url: "" },
      { full_name: "b/three", description: null, archived: false, ssh_url: "", html_url: "" },
    ]);
  }) as typeof fetch;

  const repos = await fetchGhRepos();
  expect(call).toBe(2);
  expect(repos.map((r) => r.nameWithOwner)).toEqual(["a/one", "b/three"]);
});

test("searchRepos hits /search/repositories", async () => {
  globalThis.fetch = (async (url: string | URL | Request) => {
    expect(url.toString()).toContain("/search/repositories?q=foo");
    return jsonResponse({
      items: [{ full_name: "x/foo", description: null, archived: false, ssh_url: "", html_url: "" }],
    });
  }) as typeof fetch;
  const r = await searchRepos("foo");
  expect(r).toEqual([{ nameWithOwner: "x/foo", description: null }]);
});

test("createRepo posts to /user/repos when owner == current user", async () => {
  const calls: Array<{ url: string; method?: string }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = url.toString();
    calls.push({ url: u, method: init?.method });
    if (u.endsWith("/user")) return jsonResponse({ login: "alice" });
    if (u.endsWith("/user/repos")) {
      return jsonResponse({
        full_name: "alice/new",
        ssh_url: "git@github.com:alice/new.git",
        html_url: "https://github.com/alice/new",
      });
    }
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;

  const r = await createRepo("alice", "new");
  expect(r.sshUrl).toBe("git@github.com:alice/new.git");
  expect(calls.find((c) => c.method === "POST")!.url).toContain("/user/repos");
});

test("createRepo posts to /orgs/{org}/repos for org owner", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = url.toString();
    if (init?.method === "POST") calls.push(u);
    if (u.endsWith("/user")) return jsonResponse({ login: "alice" });
    return jsonResponse({
      full_name: "myorg/new",
      ssh_url: "git@github.com:myorg/new.git",
      html_url: "https://github.com/myorg/new",
    });
  }) as typeof fetch;

  await createRepo("myorg", "new");
  expect(calls[0]).toContain("/orgs/myorg/repos");
});

test("ghFetch surfaces error body and rate-limit hint on 403", async () => {
  globalThis.fetch = (async () =>
    new Response("rate limited", {
      status: 403,
      headers: { "x-ratelimit-remaining": "0" },
    })) as typeof fetch;
  await expect(fetchGhRepos()).rejects.toThrow(/rate limit exhausted/);
});

test("redactToken scrubs all known GitHub token shapes", () => {
  expect(redactToken("oops ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa here"))
    .toBe("oops <redacted> here");
  expect(redactToken("github_pat_11ABCDEFG_aaaaaaaaaaaaaaaaaaaaaaa"))
    .toBe("<redacted>");
  expect(redactToken("classic 0123456789abcdef0123456789abcdef01234567 done"))
    .toBe("classic <redacted> done");
  // Doesn't munge unrelated text.
  expect(redactToken("error 401 unauthorized")).toBe("error 401 unauthorized");
});

test("ghFetch error body has tokens redacted before throwing", async () => {
  globalThis.fetch = (async () =>
    new Response("token ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa is invalid", {
      status: 401,
    })) as typeof fetch;
  await expect(fetchGhRepos()).rejects.toThrow(/<redacted>/);
});
