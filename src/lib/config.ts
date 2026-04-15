import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { projectsDir, type RepoInfo } from "./paths.ts";

/**
 * Check if projects directory exists
 */
export async function projectsDirExists(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["test", "-d", projectsDir()]);
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Create the projects directory
 */
export async function createProjectsDir(): Promise<void> {
  const proc = Bun.spawn(["mkdir", "-p", projectsDir()]);
  await proc.exited;
}

/**
 * Scan ~/Projects/<org>/<repo> directories and return tracked git projects.
 * Non-git directories are ignored so stray folders do not appear as
 * confusing "Not installed" entries in `prj list` / `prj rm`.
 */
export function scanProjects(): RepoInfo[] {
  const repos: RepoInfo[] = [];
  const root = projectsDir();
  try {
    const orgs = readdirSync(root, { withFileTypes: true });
    for (const org of orgs) {
      if (!org.isDirectory() || org.name.startsWith(".")) continue;
      const orgPath = join(root, org.name);
      const projects = readdirSync(orgPath, { withFileTypes: true });
      for (const project of projects) {
        if (!project.isDirectory() || project.name.startsWith(".")) continue;
        const fullPath = join(orgPath, project.name);
        if (!existsSync(join(fullPath, ".git"))) continue;
        repos.push({
          username: org.name,
          repoName: project.name,
          fullPath,
          displayName: `${org.name}/${project.name}`,
        });
      }
    }
  } catch {
    // ~/Projects doesn't exist yet
  }
  return repos.sort((a, b) => a.displayName.localeCompare(b.displayName));
}
