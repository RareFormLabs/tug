import { createLoadedRuntime } from "../core/runtime";
import type { LoadedRuntime, RuntimeOptions, TaskResult } from "../types";

export const sharedArgs = {
  config: {
    type: "string" as const,
    description: "Path to tug.toml",
  },
  "env-file": {
    type: "string" as const,
    description: "Override local .env path",
  },
  force: {
    type: "boolean" as const,
    description: "Skip confirmations for destructive tasks",
  },
  "dry-run": {
    type: "boolean" as const,
    description: "Print file sync changes without mutating files",
  },
  verbose: {
    type: "boolean" as const,
    description: "Show extra output",
  },
  json: {
    type: "boolean" as const,
    description: "Print machine-readable output when supported",
  },
};

export function optionsFromArgs(args: Record<string, unknown>): RuntimeOptions {
  return {
    cwd: process.cwd(),
    configPath: typeof args.config === "string" ? args.config : undefined,
    envFile: typeof args["env-file"] === "string" ? args["env-file"] : undefined,
    force: Boolean(args.force),
    dryRun: Boolean(args["dry-run"]),
    verbose: Boolean(args.verbose),
    json: Boolean(args.json),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  };
}

export async function withRuntime<T>(
  args: Record<string, unknown>,
  callback: (runtime: LoadedRuntime) => Promise<T>,
): Promise<T> {
  const options = optionsFromArgs(args);
  const runtime = await createLoadedRuntime(options);
  return callback(runtime);
}

export function printTaskResult(result: TaskResult): void {
  console.log(result.summary);
  if (result.artifacts && result.artifacts.length > 0) {
    console.log(`Artifacts:\n${result.artifacts.join("\n")}`);
  }
}
