import { mkdir } from "node:fs/promises";
import path from "node:path";
import { uniq } from "es-toolkit";
import { shellQuote } from "../core/shell";
import type {
  CommandSpec,
  FolderAction,
  LoadedRuntime,
  PreparedTask,
  TaskPlan,
} from "../types";
import { ensureTaskEnabled, executePlan, ok } from "./shared";

function baseExcludeArgs(extra: string[]): string[] {
  return uniq([".git", ".env", ".DS_Store", ...extra]).flatMap((pattern) => [
    `--exclude=${pattern}`,
  ]);
}

function remoteLabel(runtime: LoadedRuntime): string {
  return `${runtime.config.remote.user}@${runtime.config.remote.host}`;
}

export function buildFolderPushCommands(runtime: LoadedRuntime, dryRun = runtime.options.dryRun): CommandSpec[] {
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
        ...(dryRun ? ["--dry-run"] : []),
        ...baseExcludeArgs(runtime.config.files.exclude),
        `--rsh=ssh -p ${runtime.config.remote.port}`,
        `--rsync-path=mkdir -p ${shellQuote(remotePath)} && rsync`,
        `${path.resolve(runtime.options.cwd, folder)}/`,
        `${runtime.config.remote.user}@${runtime.config.remote.host}:${remoteFolder}`,
      ],
      stdout: "pipe" as const,
      stderr: "pipe" as const,
      display: `Push ${folder}/`,
      formatLine: (line: string) => {
        const change = parseItemizedLine(folder, line);
        return change && formatChange(change);
      },
      progress: { kind: "lines" as const },
    };
  });
}

export function buildFolderPullCommands(runtime: LoadedRuntime, dryRun = runtime.options.dryRun): CommandSpec[] {
  return runtime.config.files.pull.map((folder) => {
    const remotePath = path.posix.join(runtime.config.remote.app_path, folder);
    return {
      command: "rsync",
      args: [
        "--archive",
        "--compress",
        "--itemize-changes",
        ...(dryRun ? ["--dry-run"] : []),
        ...baseExcludeArgs(runtime.config.files.exclude),
        `--rsh=ssh -p ${runtime.config.remote.port}`,
        `${remoteLabel(runtime)}:${shellQuote(`${remotePath}/`)}`,
        `${path.resolve(runtime.options.cwd, folder)}/`,
      ],
      stdout: "pipe" as const,
      stderr: "pipe" as const,
      display: `Pull ${folder}/`,
      formatLine: (line: string) => {
        const change = parseItemizedLine(folder, line);
        return change && formatChange(change);
      },
      progress: { kind: "lines" as const },
    };
  });
}

export interface FolderChange {
  folder: string;
  kind: "new" | "changed" | "deleted";
  path: string;
}

/**
 * Parse `rsync --itemize-changes` output. Attribute-only updates (lines starting
 * with ".") are ignored since they don't change file contents.
 */
/**
 * Parse one `rsync --itemize-changes` line. Attribute-only updates (codes starting
 * with ".") are ignored since they don't change file contents.
 */
export function parseItemizedLine(folder: string, line: string): FolderChange | null {
  const match = /^(\S+)\s+(.+)$/.exec(line.trimEnd());
  if (!match) {
    return null;
  }
  const [, code, file] = match;
  if (code === "*deleting") {
    return { folder, kind: "deleted", path: file! };
  }
  if (/^[<>ch][fdLDS]/.test(code!)) {
    // GNU rsync prints 11-character codes, macOS openrsync 9; new items are all "+".
    return { folder, kind: /^..\++$/.test(code!) ? "new" : "changed", path: file! };
  }
  return null;
}

export function parseItemizedChanges(folder: string, output: string): FolderChange[] {
  return output
    .split("\n")
    .map((line) => parseItemizedLine(folder, line))
    .filter((change): change is FolderChange => change !== null);
}

const marks = { new: "+", changed: "~", deleted: "-" } as const;

function formatChange(change: FolderChange): string {
  return `${marks[change.kind]} ${path.posix.join(change.folder, change.path)}`;
}

const PREVIEW_LIMIT = 30;

export function describeChanges(changes: FolderChange[]): string[] {
  if (changes.length === 0) {
    return [];
  }
  const lines = changes.slice(0, PREVIEW_LIMIT).map(formatChange);
  if (changes.length > PREVIEW_LIMIT) {
    lines.push(`… and ${changes.length - PREVIEW_LIMIT} more`);
  }
  const count = (kind: FolderChange["kind"]): number => changes.filter((change) => change.kind === kind).length;
  lines.push("", `${count("new")} new, ${count("changed")} changed, ${count("deleted")} deleted`);
  return lines;
}

async function previewChanges(runtime: LoadedRuntime, action: FolderAction): Promise<FolderChange[]> {
  const folders = action === "push" ? runtime.config.files.push : runtime.config.files.pull;
  const commands = action === "push" ? buildFolderPushCommands(runtime, true) : buildFolderPullCommands(runtime, true);
  return runtime.reporter.step(`Comparing local and ${runtime.config.remote.host}`, async () => {
    const changes: FolderChange[] = [];
    for (const [index, command] of commands.entries()) {
      if (action === "pull") {
        // A pull preview against a folder that doesn't exist locally yet would fail.
        await mkdir(path.resolve(runtime.options.cwd, folders[index]!), { recursive: true });
      }
      const result = await runtime.runner.run(command);
      changes.push(...parseItemizedChanges(folders[index]!, result.stdout));
    }
    return changes;
  });
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

/**
 * Resolve a folder sync. When `preview` is set, a dry run first lists exactly
 * which files will be created, changed, or deleted.
 */
export async function prepare(
  runtime: LoadedRuntime,
  action: FolderAction,
  { preview = false }: { preview?: boolean } = {},
): Promise<PreparedTask> {
  const taskPlan = await plan(runtime, action);
  const folders = action === "push" ? runtime.config.files.push : runtime.config.files.pull;
  const direction = action === "push" ? `to ${runtime.config.remote.host}` : `from ${runtime.config.remote.host}`;
  const dryRun = runtime.options.dryRun;

  let details = [`${action === "push" ? "Push" : "Pull"} ${folders.join(", ")} ${direction}`];
  let changeCount: number | null = null;
  if (preview && !dryRun) {
    const changes = await previewChanges(runtime, action);
    changeCount = changes.length;
    // The preview tells us how many files each folder will sync, so the run can show a bar.
    taskPlan.commands = taskPlan.commands.map((command, index) => ({
      ...command,
      progress: { kind: "lines", total: changes.filter((change) => change.folder === folders[index]).length },
    }));
    if (changes.length > 0) {
      details = [...details, "", ...describeChanges(changes)];
    }
  }

  const execute = async () => {
    if (action === "pull" && !dryRun) {
      for (const folder of folders) {
        await mkdir(path.resolve(runtime.options.cwd, folder), { recursive: true });
      }
    }
    await executePlan(runtime, taskPlan);
    return ok(dryRun ? "Dry run finished. No files were changed." : `${taskPlan.title} finished.`);
  };

  if (changeCount === 0) {
    return {
      id: taskPlan.id,
    title: taskPlan.title,
      details,
      nothingToDo: action === "push" ? "Remote already matches local. Nothing to push." : "Local already matches remote. Nothing to pull.",
      execute,
    };
  }

  return {
    id: taskPlan.id,
    title: taskPlan.title,
    details,
    // Pulls never delete local files, so only pushes ask first.
    confirm:
      action === "push" && !dryRun
        ? { message: `Push ${changeCount ?? "these"} change(s) to ${runtime.config.remote.host}?`, initialValue: false }
        : undefined,
    execute,
  };
}
