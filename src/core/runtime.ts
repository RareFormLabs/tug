import { loadRuntimeConfig } from "./config";
import { MemoryLogger } from "./logging";
import { BunProcessRunner } from "./process";
import type { LoadedRuntime, RuntimeOptions } from "../types";

export async function createLoadedRuntime(options: RuntimeOptions): Promise<LoadedRuntime> {
  const config = await loadRuntimeConfig(options);
  return {
    options,
    config,
    runner: new BunProcessRunner(),
    logger: new MemoryLogger(),
  };
}
