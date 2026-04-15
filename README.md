# prj

I get it. Its not easy to manage all of the repos you're working on. Now you can with this simple CLI tool to manage and organize your git projects in a consistent directory structure.

You're a pro. Get pro level repo management with `prj`.

## Installation

### Homebrew (macOS)

```bash
brew tap chandlerroth/tap
brew install prj
```

### Manual Installation

Download the latest release from [GitHub Releases](https://github.com/chandlerroth/prj/releases):

```bash
# macOS Apple Silicon
curl -L https://github.com/chandlerroth/prj/releases/latest/download/prj-darwin-arm64.tar.gz | tar xz
sudo mv prj-darwin-arm64 /usr/local/bin/prj

# macOS Intel
curl -L https://github.com/chandlerroth/prj/releases/latest/download/prj-darwin-x64.tar.gz | tar xz
sudo mv prj-darwin-x64 /usr/local/bin/prj

# Linux x64
curl -L https://github.com/chandlerroth/prj/releases/latest/download/prj-linux-x64.tar.gz | tar xz
sudo mv prj-linux-x64 /usr/local/bin/prj
```

### Build from Source

Requires [Bun](https://bun.sh):

```bash
git clone https://github.com/chandlerroth/prj.git
cd prj
bun install
bun build src/index.ts --compile --outfile prj
sudo mv prj /usr/local/bin/
```

## Shell Integration

For `prj list` and `prj rm` to change your shell's working directory, add this to your `~/.zshrc` or `~/.bashrc`:

```bash
curl -o ~/.prj.sh https://raw.githubusercontent.com/chandlerroth/prj/main/prj.sh
echo 'source ~/.prj.sh' >> ~/.zshrc
```

## Quick Start

```bash
# Initialize your projects directory
prj init

# Clone a repo (interactive picker if no repo given)
prj add user/repo
prj add

# Create a new private GitHub repo and clone it
prj create my-app

# Publish current directory as a private GitHub repo
prj create .

# Interactive project selector (changes directory on selection)
prj list

# Remove a project
prj rm      # interactive picker
prj rm chandlerroth/prj
prj rm .    # current directory
```

## Commands

| Command | Alias | Description | `--non-interactive` |
|---------|-------|-------------|---------------------|
| `prj init` | - | Initialize `~/Projects` directory | ✓ |
| `prj add [repo]` | `a` | Clone a repository (interactive picker if no repo given) | ✓ (`--repo=<url>`) |
| `prj create <name>` | `c` | Create a new private GitHub repo and clone it | ✓ (`--name=<name>`) |
| `prj create .` | - | Publish current directory as a private GitHub repo | ✓ |
| `prj list` | `l` | Interactive project selector | ✓ |
| `prj search [query]` | `s` | Search GitHub repos (interactive picker if no query) | ✓ |
| `prj rm [project\|path\|.]` | - | Remove a project (interactive picker if no target given) | ✓ (`--force` for dirty repos) |
| `prj auth [token]` | - | Manage GitHub token (status / login / logout) | ✓ (`--action=`, `--token=`) |

## Flags

| Flag | Description |
|------|-------------|
| `--non-interactive` | Disable interactive prompts and emit JSON. Required for agent/script use. |
| `--force` | Skip safety checks (`rm` only) |
| `--repo=<url>` | `add`: repo to clone (shorthand, SSH, or HTTPS) |
| `--name=<name>` | `create`: name (`my-app`) or `org/name` |
| `--action=<a>` | `auth`: one of `status`, `login`, `logout` |
| `--token=<token>` | `auth login`: GitHub token to persist |

### Agent / scripting examples

```bash
prj list --non-interactive | jq '.[] | select(.changes > 0)'
prj add  --non-interactive --repo=acme/widget
prj create --non-interactive --name=my-app
prj auth --non-interactive --action=status
prj auth --non-interactive --action=login --token=ghp_xxx
```

## Status Indicators

```
chandlerroth/prj        git:(main) [✓ clean]
chandlerroth/other-repo git:(main) [2↑ 3 changes]
org/some-project        git:(main) [1↓]
```

- `✓ clean` — No uncommitted changes, up to date with remote
- `N↑` — Commits ahead of remote
- `N↓` — Commits behind remote
- `N changes` — Uncommitted changes
## Troubleshooting

**`No GitHub token found`**
`prj` resolves a token in this order: `$GITHUB_TOKEN` / `$GH_TOKEN`, then `~/.config/prj/config.json`, then `~/.config/gh/hosts.yml`. Run `prj auth status` to see what it picked up. Save one with `prj auth <token>` (token created at https://github.com/settings/tokens — needs `repo` scope, or `delete_repo` if you want `prj create` rollback to clean up failed attempts).

**`prj create` left an orphaned repo on GitHub**
`prj create` rolls back automatically if the clone or initial push fails. If your token lacks `delete_repo` scope, the rollback message will say so — delete the repo manually at `https://github.com/<owner>/<name>/settings`.

**`prj add` left an empty directory after a failed clone**
This shouldn't happen anymore — `add` removes the partial directory on failure. If you see one, it likely predates that fix; it's safe to `rm -rf`.

**`prj list` is slow with many repos**
Each repo runs `git status --porcelain=v2` plus `git stash list`. With dozens of repos this takes a second or two. They run in parallel via `Promise.allSettled`, so one slow repo won't block the rest.

**`prj list` / `prj rm` doesn't `cd` into the selected project**
You need shell integration. Add `eval "$(prj shell-init)"` to `~/.zshrc` or `~/.bashrc` and reopen your shell.

**Tests fail with `EACCES` on a temp dir**
`prj test` shells out to real `git` for some integration tests. Make sure `git` is on `$PATH` and your tmpdir is writable.

## Project Structure

Projects are organized under `~/Projects/<org>/<repo>`:

```
~/Projects/
├── username/
│   ├── repo1/
│   └── repo2/
└── org/
    └── repo3/
```

No config file — the filesystem is the source of truth.

## Development

```bash
# Run in development
bun run src/index.ts list

# Build binary
bun build src/index.ts --compile --outfile prj
```
