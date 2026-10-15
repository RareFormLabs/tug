import { access } from "node:fs/promises";
import type { CommandResult, CommandSpec, LoadedRuntime, TaskPlan, TaskResult, TugConfig } from "../types";

export async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export function isDisabled(config: TugConfig, taskId: string): boolean {
  return config.project.disabled_tasks.includes(taskId);
}

export function ensureTaskEnabled(config: TugConfig, taskId: string): void {
  if (isDisabled(config, taskId)) {
    throw new Error(`Task ${taskId} is disabled in tug.toml.`);
  }
}

export function ensureComposerEnabled(config: TugConfig): void {
  if (!config.composer.enabled) {
    throw new Error("Composer tasks are disabled in tug.toml.");
  }
}

/** Split streamed chunks into complete, non-empty lines. */
export function lineSplitter(onLine: (line: string) => void): { push(text: string): void; flush(): void } {
  let pending = "";
  return {
    push(text) {
      const parts = (pending + text).split(/\r?\n|\r/);
      pending = parts.pop() ?? "";
      for (const part of parts) {
        if (part.trim()) {
          onLine(part.trimEnd());
        }
      }
    },
    flush() {
      if (pending.trim()) {
        onLine(pending.trimEnd());
      }
      pending = "";
    },
  };
}

export async function runStep(runtime: LoadedRuntime, label: string, command: CommandSpec): Promise<CommandResult> {
  return runtime.reporter.step(label, async (step) => {
    const spec = command.progress;
    let files = 0;
    const stdout = lineSplitter((line) => {
      const formatted = command.formatLine ? command.formatLine(line) : line;
      if (formatted === null) {
        return;
      }
      step.line(formatted);
      if (spec?.kind === "lines") {
        files += 1;
        step.progress({ done: files, total: spec.total, unit: "files" });
      }
    });
    const stderr = lineSplitter((line) => step.line(line));

    let onStdinBytes: ((bytes: number) => void) | undefined;
    let onStdoutBytes: ((bytes: number) => void) | undefined;
    if (spec?.kind === "stdinBytes" && command.stdinFile) {
      const total = Bun.file(command.stdinFile).size;
      onStdinBytes = (bytes) => step.progress({ done: bytes, total, unit: "bytes" });
    } else if (spec?.kind === "stdoutBytes") {
      // An unknown size just shows the running amount instead of a bar.
      const total = await spec.total?.().catch(() => undefined);
      onStdoutBytes = (bytes) => step.progress({ done: bytes, total, unit: "bytes" });
    }

    try {
      return await runtime.runner.run(command, {
        onStdout: (text) => stdout.push(text),
        onStderr: (text) => stderr.push(text),
        onStdinBytes,
        onStdoutBytes,
      });
    } finally {
      stdout.flush();
      stderr.flush();
    }
  });
}

export async function executePlan(runtime: LoadedRuntime, plan: TaskPlan): Promise<void> {
  const total = plan.commands.length;
  for (const [index, command] of plan.commands.entries()) {
    const label = command.display ?? [command.command, ...(command.args ?? [])].join(" ");
    await runStep(runtime, total > 1 ? `[${index + 1}/${total}] ${label}` : label, command);
  }
}

export function ok(summary: string, artifacts?: string[]): TaskResult {
  return { ok: true, summary, artifacts };
}
