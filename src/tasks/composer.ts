import path from "node:path";
import { copyFile, mkdir } from "node:fs/promises";
import type {
  CommandSpec,
  ComposerAction,
  LoadedRuntime,
  TaskPlan,
  TaskResult,
} from "../types";
import { createBackupSession } from "../core/paths";
import { ensureComposerEnabled, ensureForceForDestructive, executePlan, fileExists, ok } from "./shared";

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
      `${runtime.config.remote.user}@${runtime.config.remote.host}:${path.posix.join(runtime.config.remote.app_path, file)}`,
      path.resolve(runtime.options.cwd, file),
    ],
    stdout: "pipe",
    stderr: "pipe",
    display: `rsync pull ${file}`,
    allowFailure: index === 1,
  }));
}

function buildRemoteBackupCommands(runtime: LoadedRuntime, backupDir: string): CommandSpec[] {
  return composerFiles.map((file) => ({
    command: "rsync",
    args: [
      "--archive",
      `--rsh=ssh -p ${runtime.config.remote.port}`,
      `${runtime.config.remote.user}@${runtime.config.remote.host}:${path.posix.join(runtime.config.remote.app_path, file)}`,
      path.resolve(backupDir, `remote-${file}`),
    ],
    stdout: "pipe",
    stderr: "pipe",
    display: `backup remote ${file}`,
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
      `${runtime.config.remote.user}@${runtime.config.remote.host}:${path.posix.join(runtime.config.remote.app_path, file)}`,
    ],
    stdout: "pipe",
    stderr: "pipe",
    display: `rsync push ${file}`,
    allowFailure: file === "composer.lock",
  }));
}

export async function plan(runtime: LoadedRuntime, action: ComposerAction): Promise<TaskPlan> {
  ensureComposerEnabled(runtime.config);
  const session = await createBackupSession(runtime.options.cwd, runtime.config);
  await mkdir(session.backupDir, { recursive: true });
  const commands =
    action === "pull"
      ? buildRemotePullCommands(runtime)
      : [...buildRemoteBackupCommands(runtime, session.backupDir), ...buildRemotePushCommands(runtime)];

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

export async function confirmMessage(runtime: LoadedRuntime, action: ComposerAction): Promise<string> {
  return action === "pull"
    ? `Overwrite local composer files from ${runtime.config.remote.host}?`
    : `Overwrite remote composer files on ${runtime.config.remote.host}?`;
}

export async function run(runtime: LoadedRuntime, action: ComposerAction): Promise<TaskResult> {
  const taskPlan = await plan(runtime, action);
  ensureForceForDestructive(runtime, taskPlan);
  const session = await createBackupSession(runtime.options.cwd, runtime.config);
  if (action === "pull") {
    await backupLocalComposerFiles(runtime, session.backupDir);
  } else {
    const localComposer = path.resolve(runtime.options.cwd, "composer.json");
    if (!(await fileExists(localComposer))) {
      throw new Error("composer.json is required for composer push.");
    }
  }
  await executePlan(runtime, taskPlan);
  return ok(`${taskPlan.title} finished successfully.`, [session.backupDir]);
}
