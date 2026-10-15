import path from "node:path";
import { copyFile } from "node:fs/promises";
import type {
  CommandSpec,
  ComposerAction,
  LoadedRuntime,
  PreparedTask,
  TaskPlan,
} from "../types";
import { ensureBackupSession, planBackupSession } from "../core/paths";
import { shellQuote } from "../core/shell";
import { ensureComposerEnabled, ensureTaskEnabled, executePlan, fileExists, ok } from "./shared";

/** Composer sync is switched off for now: hidden from the menu and the CLI. */
export const COMPOSER_TASKS_AVAILABLE = false;

const composerFiles = ["composer.json", "composer.lock"] as const;

async function backupLocalComposerFiles(runtime: LoadedRuntime, backupDir: string): Promise<void> {
  for (const file of composerFiles) {
    const from = path.resolve(runtime.options.cwd, file);
    if (await fileExists(from)) {
      await copyFile(from, path.resolve(backupDir, `local-${file}`));
    }
  }
}

function buildRemotePullCommands(runtime: LoadedRuntime): CommandSpec[] {
  return composerFiles.map((file, index) => ({
    command: "rsync",
    args: [
      "--archive",
      `--rsh=ssh -p ${runtime.config.remote.port}`,
      `${runtime.config.remote.user}@${runtime.config.remote.host}:${shellQuote(path.posix.join(runtime.config.remote.app_path, file))}`,
      path.resolve(runtime.options.cwd, file),
    ],
    stdout: "pipe",
    stderr: "pipe",
    display: `Pull ${file}`,
    allowFailure: index === 1,
  }));
}

function buildRemoteBackupCommands(runtime: LoadedRuntime, backupDir: string): CommandSpec[] {
  return composerFiles.map((file) => ({
    command: "rsync",
    args: [
      "--archive",
      `--rsh=ssh -p ${runtime.config.remote.port}`,
      `${runtime.config.remote.user}@${runtime.config.remote.host}:${shellQuote(path.posix.join(runtime.config.remote.app_path, file))}`,
      path.resolve(backupDir, `remote-${file}`),
    ],
    stdout: "pipe",
    stderr: "pipe",
    display: `Back up remote ${file}`,
    allowFailure: file === "composer.lock",
  }));
}

function buildRemotePushCommands(runtime: LoadedRuntime): CommandSpec[] {
  return composerFiles.map((file) => ({
    command: "rsync",
    args: [
      "--archive",
      `--rsh=ssh -p ${runtime.config.remote.port}`,
      path.resolve(runtime.options.cwd, file),
      `${runtime.config.remote.user}@${runtime.config.remote.host}:${shellQuote(path.posix.join(runtime.config.remote.app_path, file))}`,
    ],
    stdout: "pipe",
    stderr: "pipe",
    display: `Push ${file}`,
    allowFailure: file === "composer.lock",
  }));
}

export async function plan(
  runtime: LoadedRuntime,
  action: ComposerAction,
  backupDir?: string,
): Promise<TaskPlan> {
  ensureComposerEnabled(runtime.config);
  ensureTaskEnabled(runtime.config, action === "pull" ? "composerPull" : "composerPush");
  const commands =
    action === "pull"
      ? buildRemotePullCommands(runtime)
      : [
          ...(backupDir ? buildRemoteBackupCommands(runtime, backupDir) : []),
          ...buildRemotePushCommands(runtime),
        ];

  return {
    id: action === "pull" ? "composerPull" : "composerPush",
    title: action === "pull" ? "Composer pull" : "Composer push",
    summary:
      action === "pull"
        ? "Replace local composer files from the remote app."
        : "Upload local composer files to the remote app.",
    target: runtime.config.remote.host,
    destructive: action === "push" || action === "pull",
    commands,
  };
}

export async function prepare(runtime: LoadedRuntime, action: ComposerAction): Promise<PreparedTask> {
  const session = planBackupSession(runtime.options.cwd, runtime.config);
  const taskPlan = await plan(runtime, action, session.backupDir);
  const host = runtime.config.remote.host;
  if (action === "push" && !(await fileExists(path.resolve(runtime.options.cwd, "composer.json")))) {
    throw new Error("composer.json is required for composer push.");
  }
  const backupDir = path.relative(runtime.options.cwd, session.backupDir);

  return {
    id: taskPlan.id,
    title: taskPlan.title,
    details:
      action === "pull"
        ? [`Copy composer.json and composer.lock from ${host} into this project.`, `Local copies are backed up to ${backupDir}/ first.`]
        : [`Copy local composer.json and composer.lock to ${host}.`, `Remote copies are backed up to ${backupDir}/ first.`],
    confirm:
      action === "pull"
        ? { message: "Overwrite local composer files?", initialValue: true }
        : { message: `Overwrite composer files on ${host}?`, initialValue: false },
    execute: async () => {
      await ensureBackupSession(session);
      if (action === "pull") {
        await backupLocalComposerFiles(runtime, session.backupDir);
      }
      await executePlan(runtime, taskPlan);
      return ok(`${taskPlan.title} finished.`, [session.backupDir]);
    },
  };
}
