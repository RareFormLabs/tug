# tug

`tug` is a Bun + TypeScript CLI/TUI for common Craft CMS deployment workflows: file sync, database sync, composer file sync, backups, diagnostics, and remote shell access.

## Requirements

- Bun 1.3+
- Zig for OpenTUI development and builds
- macOS-first support in v1
- Runtime tools:
  - `ssh`
  - `rsync`
  - `gzip`
  - `mysql` and `mysqldump` for MySQL/MariaDB projects
  - `psql` and `pg_dump` for Postgres projects

## Install

```bash
bun install
```

## Run

```bash
bun run src/cli/main.ts
```

## Commands

- `tug`
- `tug init`
- `tug doctor`
- `tug db doctor`
- `tug folder pull`
- `tug folder push`
- `tug db pull`
- `tug db push`
- `tug composer pull`
- `tug composer push`
- `tug shell`
- `tug backups list`
- `tug backups open`

## Development

```bash
bun run lint
bun run typecheck
bun test
```
