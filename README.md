# tug

`tug` is a Bun + TypeScript CLI for common Craft CMS deployment workflows: file sync, database sync, composer file sync, backups, diagnostics, and remote shell access.

## Requirements

- Bun 1.3+
- macOS-first support in v1
- Runtime tools:
  - `ssh`
  - `rsync`
  - `gzip`
  - `mysql` and `mysqldump` for MySQL/MariaDB projects
  - `psql` and `pg_dump` for Postgres projects

When Tug runs on macOS, local database credentials using `host.containers.internal`
or `host.docker.internal` are translated to `127.0.0.1` for the host-side
`mysql`, `mysqldump`, `psql`, and `pg_dump` commands. The project `.env` and
remote database credentials are not modified.

## Install

```bash
bun install
```

## Run

```bash
bun run src/cli/main.ts
```

Running `tug` with no arguments opens a menu of tasks. Pick one, review what it
will change, confirm, and watch it run. Output stays in your normal terminal
scrollback and you come back to the menu when it finishes. If the project has no
`tug.toml` yet, tug offers to set one up.

`tug` looks for `tug.toml` in the current folder and its parents, so it works
from anywhere inside the project.

### What each task does before changing anything

- **Push folders** runs an rsync dry run first and lists every file that will be
  created, changed, or deleted on the remote. Nothing is asked when nothing differs.
- **Pull / push database** reads both `.env` files and checks the needed tools on
  both sides, then shows exactly which database replaces which. Both databases are
  backed up to `.tug/backups/<timestamp>/` before anything is replaced.
- **Composer pull / push** backs up the files it is about to overwrite.
- Confirmations for tasks that change the remote default to **No**.

Backups can be restored into the local database from the **Backups** menu or with
`tug db restore`. `tug init` adds `.tug/` to an existing `.gitignore` so database
dumps stay out of git.

## Commands

- `tug`: interactive menu
- `tug init`: set up `tug.toml` (asks a few questions in a terminal)
- `tug doctor`: check config, tools, SSH, and database settings
- `tug folder pull` / `tug folder push`
- `tug db pull` / `tug db push`
- `tug db restore [file]`: restore a `.sql.gz` backup into the local database
- `tug db doctor`
- `tug composer pull` / `tug composer push`
- `tug shell`
- `tug backups list` / `tug backups open`

Subcommands ask for confirmation in a terminal just like the menu. In scripts and
CI, pass `--yes` (`-y`, or `--force`) to run destructive tasks without a prompt.
Other flags: `--dry-run` (folder sync preview only), `--verbose` (show all command
output), `--json` (doctor reports), `--config`, `--env-file`.

## Development

```bash
bun run lint
bun run typecheck
bun test
```
