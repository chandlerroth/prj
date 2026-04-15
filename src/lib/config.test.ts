import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We import the module under test via dynamic import after setting HOME so
// PROJECTS_DIR resolves to our temp dir.
async function withTempProjects(setup: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "prj-test-"));
  const home = mkdtempSync(join(tmpdir(), "prj-home-"));
  process.env.HOME = home;
  mkdirSync(join(home, "Projects"), { recursive: true });
  setup(join(home, "Projects"));
  // Re-import with cache busting via a unique query string isn't supported by
  // bun's loader, so we read fresh by deleting from the module registry.
  // Simpler: just use a child Bun.spawn to run a tiny script. But we can also
  // just import once per test file — paths.ts caches PROJECTS_DIR at load.
  // To keep this self-contained, shell out:
  return root;
}

test("scanProjects returns sorted org/repo entries from ~/Projects", async () => {
  const home = mkdtempSync(join(tmpdir(), "prj-home-"));
  const projects = join(home, "Projects");
  mkdirSync(join(projects, "alice", "one"), { recursive: true });
  mkdirSync(join(projects, "alice", "one", ".git"), { recursive: true });
  mkdirSync(join(projects, "alice", "two"), { recursive: true });
  mkdirSync(join(projects, "alice", "two", ".git"), { recursive: true });
  mkdirSync(join(projects, "bob", "three"), { recursive: true });
  mkdirSync(join(projects, "bob", "three", ".git"), { recursive: true });
  mkdirSync(join(projects, "bob", "stale"), { recursive: true });
  mkdirSync(join(projects, ".hidden", "skip"), { recursive: true });
  writeFileSync(join(projects, "alice", ".dotfile"), "");

  // paths.ts reads HOME at module load, so run scanProjects in a subprocess
  // with HOME pointed at our fixture.
  const script = `
    import { scanProjects } from "${join(import.meta.dir, "config.ts").replace(/\\/g, "\\\\")}";
    console.log(JSON.stringify(scanProjects().map(r => r.displayName)));
  `;
  const proc = Bun.spawn(["bun", "-e", script], {
    env: { ...process.env, HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const names = JSON.parse(out.trim());
  expect(names).toEqual(["alice/one", "alice/two", "bob/three"]);
});

test("scanProjects returns [] when ~/Projects is missing", async () => {
  const home = mkdtempSync(join(tmpdir(), "prj-home-"));
  // No Projects dir created.
  const script = `
    import { scanProjects } from "${join(import.meta.dir, "config.ts").replace(/\\/g, "\\\\")}";
    console.log(JSON.stringify(scanProjects()));
  `;
  const proc = Bun.spawn(["bun", "-e", script], {
    env: { ...process.env, HOME: home },
    stdout: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  expect(JSON.parse(out.trim())).toEqual([]);
});
