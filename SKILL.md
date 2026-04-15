---
name: prj
description: 'Manage git repositories with the prj CLI. Use when the user wants to create a new project/repo, clone a repo, list projects, or remove a project. Triggers include "create a new project", "new repo", "clone repo", "list projects", "remove project", "prj", or any project management task involving ~/Projects.'
allowed-tools: Bash
---

# prj — Project Manager CLI

Manage git repositories under `~/Projects/<org>/<repo>`.

## Commands

| Command | Description |
|---|---|
| `prj init` | Initialize `~/Projects` directory |
| `prj add [repo]` | Clone a repository. Without args, opens interactive GitHub repo picker |
| `prj add user/repo` | Clone a specific repo by shorthand |
| `prj create <name>` | Create a new **private** GitHub repo and clone it to `~/Projects/<user>/<name>` |
| `prj create org/name` | Create a new private repo under a specific org |
| `prj create .` | Publish current directory as a private GitHub repo and move it into `~/Projects` |
| `prj list` | Interactive project selector (cd's into selection via shell integration) |
| `prj list --non-interactive` | Print status for all projects without interactive picker |
| `prj rm [project\|path\|.]` | Remove a project (interactive picker if no target given) |
| `prj rm .` | Remove the project in the current directory |

## Important Notes

- **Do NOT pass flags like `--help` or `-h` to `prj create`** — it interprets all args as repo names.
- `prj create` always creates **private** repos.
- `prj add` and `prj create` output the cloned path to stdout. The shell integration (`prj.sh`) auto-cd's into it.
- `prj rm` checks for uncommitted changes, unpushed commits, and stashes before deleting, and prompts for confirmation.
- `prj list --non-interactive` is the best way to get project status programmatically (shows branch, ahead/behind, changes).
- All projects are stored at `~/Projects/<org>/<repo>` with lowercase paths.

## When to Use

- **User wants a new project**: Run `prj create <name>` to create the GitHub repo and clone it. Then `cd` into the path and initialize with `bun init` or similar.
- **User wants to clone an existing repo**: Run `prj add user/repo`.
- **User wants to see their projects**: Run `prj list --non-interactive` (since Claude cannot use the interactive picker).
- **User wants to remove a project**: Use `prj rm <user/repo>` or `prj rm <absolute-path>`.

## Non-Interactive Usage (for Claude)

Since Claude cannot interact with terminal prompts, always use:
- `prj list --non-interactive` instead of `prj list`
- `prj add user/repo` (with explicit repo) instead of bare `prj add`
- `prj create <name>` (with explicit name) instead of bare `prj create`

## Source

The prj source lives at `~/Projects/chandlerroth/prj`. To rebuild after changes:

```bash
cd ~/Projects/chandlerroth/prj && bun build src/index.ts --compile --outfile prj
```

To release, create a GitHub release with compiled binaries, then update the Homebrew formula at `~/Projects/chandlerroth/homebrew-tap/Formula/prj.rb`.
