import type {
  BackupAction,
  CommandSpec,
  LoadedRuntime,
  TaskPlan,
  TaskResult,
} from "../types";
import { listBackups, resolveRuntimePaths } from "../core/paths";
import { ok } from "./shared";

function getPlatformOpener(target: string): CommandSpec {
  if (process.platform === "darwin") {
    return {
      command: "open",
      args: [target],
      stdout: "pipe",
      stderr: "pipe",
      display: `open ${target}`,
    };
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
  return {
    command: "xdg-open",
    args: [target],
    stdout: "pipe",
    stderr: "pipe",
    display: `xdg-open ${target}`,
  };
}

export async function plan(runtime: LoadedRuntime, action: BackupAction): Promise<TaskPlan> {
  const runtimePaths = resolveRuntimePaths(runtime.options.cwd, runtime.config);
  return {
    id: action === "list" ? "backups" : "backupsOpen",
    title: action === "list" ? "List backups" : "Open backups",
    summary:
      action === "list" ? "Show available backup snapshots." : "Open the backup directory.",
    target: runtimePaths.backupRoot,
    destructive: false,
    commands:
      action === "open"
        ? [getPlatformOpener(runtimePaths.backupRoot)]
        : [],
  };
}

export async function confirmMessage(): Promise<string> {
  return "Open the backups folder?";
}

export async function run(runtime: LoadedRuntime, action: BackupAction): Promise<TaskResult> {
  if (action === "list") {
    const backups = await listBackups(runtime.options.cwd, runtime.config);
    return ok(backups.length > 0 ? backups.join("\n") : "No backups found.");
  }
  const taskPlan = await plan(runtime, action);
  await runtime.runner.run(taskPlan.commands[0]!);
  return ok("Opened backups folder.");
}
