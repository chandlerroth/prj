import { type RepoInfo } from "./paths.ts";
import { executeGitWithOutput, isGitRepo, getStashCount } from "./git.ts";
import { blue, green, red, yellow } from "./colors.ts";

export interface RepoStatus {
  displayName: string;
  branch: string | null;
  ahead: number;
  behind: number;
  changes: number;
  stashes: number;
  installed: boolean;
}

/**
 * Parse the output of `git status --porcelain=v2 --branch` into a RepoStatus.
 * Format reference: https://git-scm.com/docs/git-status#_porcelain_format_version_2
 *
 *   # branch.oid <sha>
 *   # branch.head <name>
 *   # branch.upstream <upstream>
 *   # branch.ab +<ahead> -<behind>
 *   1 .M ... path
 *   2 R. ... old new
 *   ? untracked
 *   ! ignored
 */
export function parsePorcelainV2(stdout: string): {
  branch: string | null;
  ahead: number;
  behind: number;
  changes: number;
} {
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;
  let changes = 0;

  for (const line of stdout.split("\n")) {
    if (!line) continue;
    if (line.startsWith("# branch.head ")) {
      branch = line.slice("# branch.head ".length).trim() || null;
    } else if (line.startsWith("# branch.ab ")) {
      const m = line.match(/\+(\d+)\s+-(\d+)/);
      if (m) {
        ahead = parseInt(m[1], 10);
        behind = parseInt(m[2], 10);
      }
    } else if (line[0] === "1" || line[0] === "2" || line[0] === "u" || line[0] === "?") {
      // Tracked changes (1=ordinary, 2=renamed/copied, u=unmerged) or untracked.
      changes++;
    }
  }

  // Detached HEAD shows up as "(detached)"
  if (branch === "(detached)") branch = null;

  return { branch, ahead, behind, changes };
}

/**
 * Resolve status for every repo in parallel. Uses `allSettled` so a single
 * misbehaving repo (e.g. permissions, corrupted .git) can't sink the listing.
 * Failed repos are returned as `installed: false` placeholders.
 */
export async function getAllStatuses(repos: RepoInfo[]): Promise<RepoStatus[]> {
  const settled = await Promise.allSettled(
    repos.map((repo) => getRepoStatus(repo)),
  );
  return settled.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          displayName: repos[i].displayName,
          branch: null,
          ahead: 0,
          behind: 0,
          changes: 0,
          stashes: 0,
          installed: false,
        },
  );
}

export async function getRepoStatus(repo: RepoInfo): Promise<RepoStatus> {
  const status: RepoStatus = {
    displayName: repo.displayName,
    branch: null,
    ahead: 0,
    behind: 0,
    changes: 0,
    stashes: 0,
    installed: false,
  };

  if (!(await isGitRepo(repo.fullPath))) {
    return status;
  }

  status.installed = true;

  // Single git call gives us branch, ahead/behind, and change count.
  // Run stash list in parallel since it can't be folded into porcelain.
  const [statusResult, stashCount] = await Promise.all([
    executeGitWithOutput(["status", "--porcelain=v2", "--branch"], repo.fullPath),
    getStashCount(repo.fullPath),
  ]);

  if (statusResult.exitCode === 0) {
    const parsed = parsePorcelainV2(statusResult.stdout);
    status.branch = parsed.branch;
    status.ahead = parsed.ahead;
    status.behind = parsed.behind;
    status.changes = parsed.changes;
    status.stashes = stashCount;
  }

  return status;
}

/**
 * Format status as a short hint string for use in the list picker.
 * e.g. "git:(main) [✓ clean]" or "git:(main) [2↑ 3 changes]"
 */
export function formatStatusHint(status: RepoStatus): string {
  if (!status.installed) {
    return red("Not installed");
  }

  const branchStr = status.branch || "unknown";
  const parts: string[] = [];

  if (status.behind > 0) parts.push(blue(`${status.behind}\u2193`));
  if (status.ahead > 0) parts.push(yellow(`${status.ahead}\u2191`));
  if (status.changes > 0) parts.push(red(`${status.changes} changes`));
  if (status.stashes > 0) parts.push(yellow(`${status.stashes} stash${status.stashes === 1 ? "" : "es"}`));
  if (parts.length === 0) parts.push(green("\u2713 clean"));

  return `git:(${blue(branchStr)}) [${parts.join(" ")}]`;
}
