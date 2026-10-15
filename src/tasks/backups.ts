import path from "node:path";
import type { BackupAction, CommandSpec, LoadedRuntime, TaskResult } from "../types";
import { type BackupSnapshot, listBackups, resolveRuntimePaths } from "../core/paths";
import { formatSize } from "../core/format";
import { ok } from "./shared";

export { formatSize };

function getPlatformOpener(target: string): CommandSpec {
  if (process.platform === "darwin") {
    return { command: "open", args: [target], stdout: "pipe", stderr: "pipe", display: `open ${target}` };
  }
  if (process.platform === "win32") {
    return {
      command: "cmd",
      args: ["/c", "start", "", target],
      stdout: "pipe",
      stderr: "pipe",
      display: `start ${target}`,
    };
  }
  return { command: "xdg-open", args: [target], stdout: "pipe", stderr: "pipe", display: `xdg-open ${target}` };
}

export function formatAge(date: Date, now = new Date()): string {
  const minutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  return `${Math.round(hours / 24)}d ago`;
}

export function snapshotSize(snapshot: BackupSnapshot): number {
  return snapshot.files.reduce((total, file) => total + file.size, 0);
}

export function formatSnapshots(snapshots: BackupSnapshot[], now = new Date()): string[] {
  return snapshots.flatMap((snapshot) => [
    `${snapshot.token}  ${formatAge(snapshot.createdAt, now)}  ${formatSize(snapshotSize(snapshot))}`,
    ...snapshot.files.map((file) => `  ${file.name}  ${formatSize(file.size)}`),
  ]);
}

/** Database dumps across all snapshots, newest first. */
export function databaseDumps(snapshots: BackupSnapshot[]): { snapshot: BackupSnapshot; file: BackupSnapshot["files"][number] }[] {
  return snapshots.flatMap((snapshot) =>
    snapshot.files.filter((file) => file.name.endsWith(".sql.gz")).map((file) => ({ snapshot, file })),
  );
}

export async function openFolder(runtime: LoadedRuntime): Promise<TaskResult> {
  const { backupRoot } = resolveRuntimePaths(runtime.options.cwd, runtime.config);
  await runtime.runner.run(getPlatformOpener(backupRoot));
  return ok(`Opened ${path.relative(runtime.options.cwd, backupRoot) || backupRoot}.`);
}

export async function run(runtime: LoadedRuntime, action: BackupAction): Promise<TaskResult> {
  if (action === "open") {
    return openFolder(runtime);
  }
  const snapshots = await listBackups(runtime.options.cwd, runtime.config);
  return ok(snapshots.length > 0 ? formatSnapshots(snapshots).join("\n") : "No backups yet.");
}
