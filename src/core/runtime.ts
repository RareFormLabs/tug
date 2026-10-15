import path from "node:path";
import { loadRuntimeConfig } from "./config";
import { findConfigPath } from "./paths";
import { BunProcessRunner } from "./process";
import { createReporter } from "./reporter";
import type { LoadedRuntime, RuntimeOptions } from "../types";

/**
 * Locate tug.toml in the working directory or a parent, and treat the directory
 * that holds it as the project root so tug works from any subfolder.
 */
export async function resolveProjectOptions(options: RuntimeOptions): Promise<RuntimeOptions> {
  if (options.configPath) {
    return options;
  }
  const found = await findConfigPath(options.cwd);
  return found ? { ...options, cwd: path.dirname(found) } : options;
}

export async function createLoadedRuntime(options: RuntimeOptions): Promise<LoadedRuntime> {
  const resolved = await resolveProjectOptions(options);
  const config = await loadRuntimeConfig(resolved);
  return {
    options: resolved,
    config,
    runner: new BunProcessRunner(),
    reporter: createReporter({ verbose: resolved.verbose }),
  };
}
