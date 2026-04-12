import path from "node:path";
import { uniq } from "es-toolkit";
import { shellQuote } from "../core/shell";
import type {
  CommandSpec,
  FolderAction,
  LoadedRuntime,
  TaskPlan,
  TaskResult,
} from "../types";
import { ensureForceForDestructive, ensureTaskEnabled, executePlan, ok } from "./shared";

function baseExcludeArgs(extra: string[]): string[] {
  return uniq([".git", ".env", ".DS_Store", ...extra]).flatMap((pattern) => [
    `--exclude=${pattern}`,
  ]);
}

export function buildFolderPushCommands(runtime: LoadedRuntime): CommandSpec[] {
  return runtime.config.files.push.map((folder) => {
    const remotePath = path.posix.join(runtime.config.remote.app_path, folder);
    const remoteFolder = shellQuote(`${remotePath}/`);
    return {
      command: "rsync",
      args: [
        "--archive",
        "--compress",
        "--itemize-changes",
        "--delete",
        ...(runtime.options.dryRun ? ["--dry-run"] : []),
        ...baseExcludeArgs(runtime.config.files.exclude),
        `--rsh=ssh -p ${runtime.config.remote.port}`,
        `--rsync-path=mkdir -p ${shellQuote(remotePath)} && rsync`,
        `${path.resolve(runtime.options.cwd, folder)}/`,
        `${runtime.config.remote.user}@${runtime.config.remote.host}:${remoteFolder}`,
      ],
      stdout: "pipe" as const,
      stderr: "pipe" as const,
      display: `rsync push ${folder}`,
    };
  });
}

export function buildFolderPullCommands(runtime: LoadedRuntime): CommandSpec[] {
  const mkdirCommands = runtime.options.dryRun ? [] : runtime.config.files.pull.map((folder) => ({
    command: "mkdir",
    args: ["-p", path.resolve(runtime.options.cwd, folder)],
    stdout: "pipe" as const,
    stderr: "pipe" as const,
    display: `mkdir -p ${folder}`,
  }));
  const rsyncCommands = runtime.config.files.pull.map((folder) => {
    const remotePath = path.posix.join(runtime.config.remote.app_path, folder);
    return {
      command: "rsync",
      args: [
        "--archive",
        "--compress",
        "--itemize-changes",
        ...(runtime.options.dryRun ? ["--dry-run"] : []),
        ...baseExcludeArgs(runtime.config.files.exclude),
        `--rsh=ssh -p ${runtime.config.remote.port}`,
        `${runtime.config.remote.user}@${runtime.config.remote.host}:${shellQuote(`${remotePath}/`)}`,
        `${path.resolve(runtime.options.cwd, folder)}/`,
      ],
      stdout: "pipe" as const,
      stderr: "pipe" as const,
      display: `rsync pull ${folder}`,
    };
  });
  return [...mkdirCommands, ...rsyncCommands];
}

export async function plan(runtime: LoadedRuntime, action: FolderAction): Promise<TaskPlan> {
  const taskId = action === "push" ? "folderPush" : "folderPull";
  ensureTaskEnabled(runtime.config, taskId);
  const folders = action === "push" ? runtime.config.files.push : runtime.config.files.pull;
  if (folders.length === 0) {
    throw new Error(`No ${action} folders configured in tug.toml.`);
  }

  return {
    id: taskId,
    title: action === "push" ? "Folder push" : "Folder pull",
    summary:
      action === "push"
        ? "Sync configured local folders to the remote app path."
        : "Sync configured remote folders back to the local project.",
    target: runtime.config.remote.host,
    destructive: action === "push",
    commands: action === "push" ? buildFolderPushCommands(runtime) : buildFolderPullCommands(runtime),
  };
}

export async function confirmMessage(runtime: LoadedRuntime, action: FolderAction): Promise<string> {
  return action === "push"
    ? `Push ${runtime.config.files.push.length} folder(s) to ${runtime.config.remote.host}?`
    : `Pull ${runtime.config.files.pull.length} folder(s) from ${runtime.config.remote.host}?`;
}

export async function run(runtime: LoadedRuntime, action: FolderAction): Promise<TaskResult> {
  const taskPlan = await plan(runtime, action);
  if (action === "push") {
    ensureForceForDestructive(runtime, taskPlan);
  }
  await executePlan(runtime, taskPlan);
  return ok(`${taskPlan.title} finished successfully.`);
}
