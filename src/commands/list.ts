import { scanProjects } from "../lib/config.ts";
import { select } from "../lib/prompt.ts";
import { yellow } from "../lib/colors.ts";
import { Spinner } from "../lib/spinner.ts";
import { getAllStatuses, formatStatusHint } from "../lib/status.ts";

export async function runList(nonInteractive = false): Promise<void> {
  const repos = scanProjects();

  if (repos.length === 0) {
    if (nonInteractive) {
      console.log("[]");
      return;
    }
    process.stderr.write(yellow("No projects found. Run 'prj add <repo>' to add one.\n"));
    return;
  }

  const spinner = nonInteractive ? null : new Spinner("Checking repositories...");
  spinner?.start();

  const statuses = await getAllStatuses(repos);

  spinner?.stop();

  if (nonInteractive) {
    const output = repos.map((repo, i) => ({
      displayName: repo.displayName,
      fullPath: repo.fullPath,
      installed: statuses[i].installed,
      branch: statuses[i].branch,
      ahead: statuses[i].ahead,
      behind: statuses[i].behind,
      changes: statuses[i].changes,
    }));
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const maxNameLen = Math.max(...repos.map((r) => r.displayName.length));

  const options = repos.map((repo, i) => ({
    label: repo.displayName.padEnd(maxNameLen),
    value: repo.fullPath,
    hint: formatStatusHint(statuses[i]),
  }));

  const selected = await select(options);

  if (selected) {
    console.log(selected);
  }
}
