To rebuild after making changes:

```
bun build src/index.ts --compile --outfile prj
```

## Commands

| Command | Description |
|---|---|
| `prj init` | Initialize `~/Projects` directory |
| `prj add [repo]` | Clone a repository (interactive picker if no repo given) |
| `prj create <name>` | Create a new private GitHub repo and clone it |
| `prj create .` | Publish current directory as a private GitHub repo |
| `prj list` | Interactive project selector |
| `prj search [query]` | Search GitHub repos (interactive picker if no query) |
| `prj rm [project\|path\|.]` | Remove a project (interactive picker if no target given) |
