import type { CommandSpec, LoadedRuntime, TaskPlan, TaskResult } from "../types";
import { shellQuote } from "../core/shell";
import { ensureTaskEnabled, ok } from "./shared";

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
  ensureTaskEnabled(runtime.config, "terminal");
  return {
    id: "terminal",
    title: "Remote shell",
    summary: "Open an interactive shell in the remote app directory.",
    target: runtime.config.remote.host,
    destructive: false,
    commands: [buildShellCommand(runtime)],
  };
}

/** Hand the terminal to an interactive SSH session in the remote app folder. */
export async function run(runtime: LoadedRuntime): Promise<TaskResult> {
  const command = (await plan(runtime)).commands[0]!;
  const result = await runtime.runner.run({ ...command, allowFailure: true });
  // ssh exits with the status of the last remote command, so only 255 means it failed to connect.
  if (result.exitCode === 255) {
    throw new Error(`Could not connect to ${runtime.config.remote.user}@${runtime.config.remote.host}.`);
  }
  return ok("Remote shell closed.");
}
