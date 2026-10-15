import { access } from "node:fs/promises";
import path from "node:path";
import { styleText } from "node:util";
import dotenv from "dotenv";
import { confirm, select, text } from "@clack/prompts";
import { ensureGitignored, writeConfig } from "../core/config";
import { inspectProject } from "../core/doctor";
import { listBackups, resolveConfigPath } from "../core/paths";
import { BunProcessRunner } from "../core/process";
import { createLoadedRuntime } from "../core/runtime";
import { playSound } from "../core/sound";
import * as backupsTask from "../tasks/backups";
import * as databaseTask from "../tasks/database";
import type { DatabaseEngine, DoctorCheck, DoctorReport, LoadedRuntime, RuntimeOptions, TugConfig } from "../types";
import { ask, runPrepared, ui, withEmoji } from "./ui";

/**
 * Project checks (config, tools, SSH, remote tools) followed by database
 * settings on both sides once SSH is known to work.
 */
export async function runDoctor(
  options: RuntimeOptions,
  onCheck?: (check: DoctorCheck) => void,
): Promise<DoctorReport> {
  const report = await inspectProject(options, new BunProcessRunner(), onCheck);
  const sshOk = report.checks.some((check) => check.id === "ssh-reachability" && check.status === "pass");
  if (!sshOk) {
    return report;
  }
  const runtime = await createLoadedRuntime(options);
  const env = await databaseTask.checkDatabaseEnv(runtime);
  for (const check of env.checks) {
    onCheck?.(check);
  }
  const checks = [...report.checks, ...env.checks];
  return { ok: checks.every((check) => check.status !== "fail"), checks };
}

export async function doctorFlow(options: RuntimeOptions): Promise<boolean> {
  const report = await runDoctor(options, (check) => ui.check(check));
  if (report.ok) {
    ui.success("Everything looks good.");
    playSound("success");
  } else {
    ui.error("Some checks failed. Fix the items above and run Doctor again.");
    playSound("error");
  }
  return report.ok;
}

/** Pick a database dump from the backups folder and restore it locally. */
export async function restoreFlow(runtime: LoadedRuntime, file?: string): Promise<void> {
  let target = file;
  if (!target) {
    if (!runtime.options.interactive) {
      throw new Error("Pass the backup file to restore, e.g. `tug db restore .tug/backups/<snapshot>/local-before-pull.sql.gz`.");
    }
    const dumps = backupsTask.databaseDumps(await listBackups(runtime.options.cwd, runtime.config));
    if (dumps.length === 0) {
      ui.info("No database backups yet. Database pulls and pushes save one before changing anything.");
      return;
    }
    target = await ask(
      select({
        message: "Restore which backup into your local database?",
        maxItems: 10,
        options: dumps.map(({ snapshot, file: dump }) => ({
          value: dump.path,
          label: `${snapshot.token}  ${dump.name}`,
          hint: `${backupsTask.formatAge(snapshot.createdAt)}, ${backupsTask.formatSize(dump.size)}`,
        })),
      }),
    );
  }
  await runPrepared(runtime, await databaseTask.prepareRestore(runtime, target));
}

export async function backupsFlow(runtime: LoadedRuntime): Promise<void> {
  const snapshots = await listBackups(runtime.options.cwd, runtime.config);
  if (snapshots.length === 0) {
    ui.info("No backups yet. Database and composer tasks save one before changing anything.");
    return;
  }
  const total = snapshots.reduce((sum, snapshot) => sum + backupsTask.snapshotSize(snapshot), 0);
  const shown = snapshots.slice(0, 8);
  const lines = backupsTask.formatSnapshots(shown);
  if (snapshots.length > shown.length) {
    lines.push(styleText("dim", `… and ${snapshots.length - shown.length} older`));
  }
  ui.note(withEmoji("backups", `Backups · ${snapshots.length} snapshot(s), ${backupsTask.formatSize(total)}`), lines);

  const hasDumps = backupsTask.databaseDumps(snapshots).length > 0;
  const choice = await ask(
    select({
      message: "Backups",
      options: [
        ...(hasDumps ? [{ value: "restore", label: "Restore a database backup locally" }] : []),
        { value: "open", label: "Open the backups folder" },
        { value: "back", label: "Back" },
      ],
    }),
  );
  if (choice === "restore") {
    await restoreFlow(runtime);
  } else if (choice === "open") {
    ui.success((await backupsTask.openFolder(runtime)).summary);
  }
}

async function firstExisting(cwd: string, candidates: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const candidate of candidates) {
    try {
      await access(path.resolve(cwd, candidate));
      found.push(candidate);
    } catch {
      // Not present in this project.
    }
  }
  return found;
}

async function detectEngine(cwd: string): Promise<DatabaseEngine | null> {
  try {
    const env = dotenv.parse(await Bun.file(path.resolve(cwd, ".env")).text());
    const driver = (env.DB_DRIVER ?? env.DATABASE_URL?.split(":")[0] ?? "").toLowerCase();
    if (driver === "mysql" || driver === "mariadb") {
      return "mysql";
    }
    if (driver.startsWith("pg") || driver.startsWith("postgres")) {
      return "postgres";
    }
  } catch {
    // No readable .env.
  }
  return null;
}

const splitList = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim().replace(/\/+$/, ""))
    .filter(Boolean);

const required = (label: string) => (value: string | undefined) =>
  value?.trim() ? undefined : `${label} is required.`;

/** Ask for the handful of settings tug needs and write tug.toml. */
export async function initWizard(cwd: string, explicitPath?: string): Promise<string | null> {
  const destination = resolveConfigPath(cwd, explicitPath);
  const host = await ask(text({ message: "Remote host", placeholder: "example.com", validate: required("Host") }));
  const user = await ask(text({ message: "SSH user", placeholder: "deploy", validate: required("User") }));
  const port = await ask(
    text({
      message: "SSH port",
      initialValue: "22",
      validate: (value) => (/^\d+$/.test(value?.trim() ?? "") ? undefined : "Port must be a number."),
    }),
  );
  const appPath = await ask(
    text({
      message: "Remote project path",
      placeholder: `/srv/users/${user}/apps/site/current`,
      validate: required("Remote project path"),
    }),
  );
  const envPath = await ask(
    text({ message: "Remote .env path", initialValue: path.posix.join(appPath.trim(), ".env") }),
  );
  const pushDefaults = await firstExisting(cwd, ["templates", "config", "modules", "translations", "web/dist"]);
  const push = await ask(
    text({
      message: "Folders to push (comma-separated)",
      initialValue: (pushDefaults.length > 0 ? pushDefaults : ["templates", "config"]).join(", "),
    }),
  );
  const pullDefaults = await firstExisting(cwd, ["web/uploads", "web/assets"]);
  const pull = await ask(
    text({
      message: "Folders to pull (comma-separated)",
      initialValue: (pullDefaults.length > 0 ? pullDefaults : ["web/uploads"]).join(", "),
    }),
  );
  const detectedEngine = await detectEngine(cwd);
  const engine =
    detectedEngine ??
    (await ask(
      select<DatabaseEngine>({
        message: "Database engine",
        options: [
          { value: "mysql", label: "MySQL / MariaDB" },
          { value: "postgres", label: "PostgreSQL" },
        ],
      }),
    ));

  const config: TugConfig = {
    project: { name: path.basename(cwd), disabled_tasks: [] },
    remote: { host: host.trim(), user: user.trim(), port: Number(port), app_path: appPath.trim(), env_path: envPath.trim() },
    files: { push: splitList(push), pull: splitList(pull), exclude: [".DS_Store", ".git", ".env"] },
    database: { engine, local_env_file: ".env", remote_env_path: envPath.trim(), backup_dir: ".tug/backups" },
    composer: { enabled: (await firstExisting(cwd, ["composer.json"])).length > 0 },
  };

  const write = await ask(confirm({ message: `Write ${path.relative(cwd, destination) || destination}?` }));
  if (!write) {
    ui.warn("Nothing was written.");
    return null;
  }
  await writeConfig(destination, config);
  ui.success(`Created ${path.relative(cwd, destination)}${detectedEngine ? ` (${engine} detected from .env)` : ""}.`);
  playSound("success");
  if (await ensureGitignored(cwd)) {
    ui.info("Added .tug/ to .gitignore so database backups stay out of git.");
  }
  return destination;
}
