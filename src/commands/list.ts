import { scanProjects } from "../lib/config.ts";
import { select } from "../lib/prompt.ts";
import { yellow } from "../lib/colors.ts";
import { Spinner } from "../lib/spinner.ts";
import { getAllStatuses, getRepoStatus, formatStatusHint } from "../lib/status.ts";

export async function runList(nonInteractive = false, fetch?: boolean): Promise<void> {
  const repos = scanProjects();

  if (repos.length === 0) {
    if (nonInteractive) {
      console.log("[]");
      return;
    }
    process.stderr.write(yellow("No projects found. Run 'prj add <repo>' to add one.\n"));
    return;
  }

  // Three modes:
  //   - "background": show picker with cached status, fetch in parallel,
  //     redraw hints as results land. Default for interactive use.
  //   - "blocking":   fetch first, then render. Used when the caller needs
  //     fully-synced output (e.g. `--non-interactive --fetch` for scripts).
  //   - "none":       skip fetch entirely. Default in non-interactive mode
  //     (keeps shell startup hooks fast); also `--no-fetch`.
  const fetchMode: "background" | "blocking" | "none" =
    fetch === false ? "none"
    : fetch === true ? "blocking"
    : nonInteractive ? "none"
    : "background";

  const spinner = nonInteractive || fetchMode !== "blocking"
    ? null
    : new Spinner("Fetching latest...");
  spinner?.start();

  const statuses = await getAllStatuses(repos, { fetch: fetchMode === "blocking" });

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
      stashes: statuses[i].stashes,
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

  const selected = await select(options, {
    onReady(control) {
      if (fetchMode !== "background") return;
      // Fire-and-forget per-repo fetch + status refresh. As each lands we
      // rewrite that row's hint in place. Errors are swallowed so a bad
      // remote can't affect the others or the picker.
      for (const repo of repos) {
        void (async () => {
          try {
            const fresh = await getRepoStatus(repo, {
              fetch: true,
              signal: control.signal,
            });
            if (control.closed) return;
            control.setHint(repo.fullPath, formatStatusHint(fresh));
          } catch {
            // ignore — keep stale hint
          }
        })();
      }
    },
  });

  if (selected) {
    console.log(selected);
  }
}
