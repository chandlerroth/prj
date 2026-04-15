import { scanProjects } from "../lib/config.ts";
import { getChangedFilesCount, getAheadBehind, getUpstream, getStashCount, isGitRepo } from "../lib/git.ts";
import { projectsDir, ensureInsideProjects } from "../lib/paths.ts";
import { red, yellow, gray } from "../lib/colors.ts";
import { select, confirm } from "../lib/prompt.ts";
import { Spinner } from "../lib/spinner.ts";
import { getAllStatuses, formatStatusHint } from "../lib/status.ts";
import { join } from "path";
import { realpathSync, rmSync } from "fs";

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function resolveRepo(arg: string, repos: ReturnType<typeof scanProjects>) {
  if (arg === ".") {
    const cwd = canonicalPath(process.cwd());
    return repos.find((r) => canonicalPath(r.fullPath) === cwd) ?? null;
  }

  const target = canonicalPath(arg);
  return repos.find((r) => r.displayName === arg || canonicalPath(r.fullPath) === target) ?? null;
}

export async function runDelete(arg: string | undefined, nonInteractive = false, force = false): Promise<void> {
  const repos = scanProjects();
  let repo;

  if (!arg) {
    if (nonInteractive) {
      console.error(red("Usage: prj rm <project|path|.>"));
      process.exit(1);
    }

    // Interactive picker
    if (repos.length === 0) {
      process.stderr.write(yellow("No projects found.\n"));
      return;
    }

    const spinner = new Spinner("Checking repositories...");
    spinner.start();

    const statuses = await getAllStatuses(repos);

    spinner.stop();

    const maxNameLen = Math.max(...repos.map((r) => r.displayName.length));

    const options = repos.map((repo, i) => ({
      label: repo.displayName.padEnd(maxNameLen),
      value: repo.fullPath,
      hint: formatStatusHint(statuses[i]),
    }));

    const selected = await select(options);
    if (!selected) return;

    repo = repos.find((r) => r.fullPath === selected) ?? null;
  } else {
    repo = resolveRepo(arg, repos);
    if (arg === "." && !repo) {
      console.error(red("Current directory is not a tracked project."));
      process.exit(1);
    }
    if (!repo) {
      console.error(red(`Project not found: ${arg}`));
      process.exit(1);
    }
  }

  if (!force) {
    console.error(`Checking ${repo.displayName}...`);

    // Check if directory exists and is a git repo
    const isRepo = await isGitRepo(repo.fullPath);

    const issues: string[] = [];

    if (isRepo) {
      // Run safety checks in parallel
      const [changedCount, upstream, stashCount] = await Promise.all([
        getChangedFilesCount(repo.fullPath),
        getUpstream(repo.fullPath),
        getStashCount(repo.fullPath),
      ]);
      if (changedCount > 0) {
        issues.push(`${changedCount} uncommitted change${changedCount === 1 ? "" : "s"}`);
      }
      if (upstream) {
        const { ahead } = await getAheadBehind(repo.fullPath, upstream);
        if (ahead > 0) {
          issues.push(`${ahead} unpushed commit${ahead === 1 ? "" : "s"}`);
        }
      }
      if (stashCount > 0) {
        issues.push(`${stashCount} stash${stashCount === 1 ? "" : "es"}`);
      }
    }

    if (issues.length > 0) {
      console.error();
      console.error(yellow("Warning: This repository has unsaved work:"));
      for (const issue of issues) {
        console.error(`  - ${issue}`);
      }
    }

    if (nonInteractive) {
      // Without --force, refuse to delete a dirty repo non-interactively.
      if (issues.length > 0) {
        console.error(red("Refusing to delete in --non-interactive mode without --force."));
        process.exit(1);
      }
    } else {
      console.error();
      const confirmed = await confirm(`Remove ${repo.displayName}? [y/N]: `);
      if (!confirmed) {
        console.error(gray("Cancelled."));
        return;
      }
    }
  }

  // Delete directory. Containment check is defense-in-depth: today
  // `repo.fullPath` always comes from `scanProjects()` (filesystem-sourced),
  // but assert anyway so a future refactor can't accidentally delete
  // outside ~/Projects. Use native rmSync rather than shelling out to
  // /bin/rm so we don't depend on PATH and can't be tripped by leading-dash
  // path edge cases.
  ensureInsideProjects(repo.fullPath);
  rmSync(repo.fullPath, { recursive: true, force: true });

  // Output parent directory (org-level) to stdout for shell integration to cd into
  const parentDir = join(projectsDir(), repo.username);
  console.log(parentDir);
}
