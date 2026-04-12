import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { MemoryLogger } from "../src/core/logging";
import type {
  CommandHooks,
  CommandResult,
  CommandSpec,
  LoadedRuntime,
  ProcessRunner,
  RuntimeOptions,
  TugConfig,
} from "../src/types";

export class MockRunner implements ProcessRunner {
  public calls: CommandSpec[] = [];

  public constructor(
    private readonly handler: (
      spec: CommandSpec,
      hooks?: CommandHooks,
    ) => Promise<CommandResult> | CommandResult = async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }),
  ) {}

  async run(spec: CommandSpec, hooks?: CommandHooks): Promise<CommandResult> {
    this.calls.push(spec);
    return this.handler(spec, hooks);
  }
}

export async function createTempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "tug-test-"));
}

export async function cleanupTempProject(cwd: string): Promise<void> {
  await rm(cwd, { recursive: true, force: true });
}

export async function writeProjectFile(cwd: string, fileName: string, content: string): Promise<string> {
  const destination = path.resolve(cwd, fileName);
  await writeFile(destination, content, "utf8");
  return destination;
}

export function createRuntime(
  cwd: string,
  config: TugConfig,
  runner: ProcessRunner,
  overrides: Partial<RuntimeOptions> = {},
): LoadedRuntime {
  return {
    options: {
      cwd,
      force: true,
      dryRun: false,
      verbose: false,
      json: false,
      interactive: false,
      ...overrides,
    },
    config,
    runner,
    logger: new MemoryLogger(),
  };
}
