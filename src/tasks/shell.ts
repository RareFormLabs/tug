import type { CommandSpec, LoadedRuntime, TaskPlan, TaskResult } from "../types";
import { shellQuote } from "../core/shell";
import { executePlan, ok } from "./shared";

export function buildShellCommand(runtime: LoadedRuntime): CommandSpec {
  const remoteAppPath = shellQuote(runtime.config.remote.app_path);
  return {
    command: "ssh",
    args: [
      "-t",
      "-p",
      String(runtime.config.remote.port),
      `${runtime.config.remote.user}@${runtime.config.remote.host}`,
      `cd ${remoteAppPath} && exec $SHELL -l`,
    ],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    display: `ssh ${runtime.config.remote.user}@${runtime.config.remote.host}`,
  };
}

export async function plan(runtime: LoadedRuntime): Promise<TaskPlan> {
  return {
    id: "terminal",
    title: "Remote shell",
    summary: "Open an interactive shell in the remote app directory.",
    target: runtime.config.remote.host,
    destructive: false,
    commands: [buildShellCommand(runtime)],
  };
}

export async function confirmMessage(): Promise<string> {
  return "Open a remote shell session?";
}

export async function run(runtime: LoadedRuntime): Promise<TaskResult> {
  const taskPlan = await plan(runtime);
  await executePlan(runtime, taskPlan);
  return ok("Remote shell session exited.");
}
