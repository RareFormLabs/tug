import { access } from "node:fs/promises";
import type { LoadedRuntime, TaskPlan, TaskResult, TugConfig } from "../types";

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

export function ensureForceForDestructive(runtime: LoadedRuntime, plan: TaskPlan): void {
  if (plan.destructive && !runtime.options.force) {
    throw new Error(`"${plan.title}" is destructive. Re-run with --force or use the interactive TUI.`);
  }
}

export async function executePlan(runtime: LoadedRuntime, plan: TaskPlan): Promise<void> {
  for (const command of plan.commands) {
    runtime.logger.add(`$ ${command.display ?? [command.command, ...(command.args ?? [])].join(" ")}`);
    await runtime.runner.run(command, {
      onStdout: (text) => {
        const trimmed = text.trimEnd();
        if (trimmed) {
          runtime.logger.add(trimmed);
        }
      },
      onStderr: (text) => {
        const trimmed = text.trimEnd();
        if (trimmed) {
          runtime.logger.add(trimmed);
        }
      },
    });
  }
}

export function ok(summary: string, artifacts?: string[]): TaskResult {
  return { ok: true, summary, artifacts };
}
