import path from "node:path";
import { styleText } from "node:util";
import { confirm, isCancel, log, note } from "@clack/prompts";
import { formatDuration } from "../core/format";
import { playSound } from "../core/sound";
import type { DoctorCheck, LoadedRuntime, PreparedTask, TaskResult } from "../types";

/** Thrown when the user backs out of a prompt (Esc or Ctrl+C). */
export class PromptCancelled extends Error {
  constructor() {
    super("Cancelled.");
  }
}

/** Unwrap a clack prompt result, turning a cancel into a PromptCancelled error. */
export async function ask<T>(prompt: Promise<T>): Promise<Exclude<T, symbol>> {
  const value = await prompt;
  if (isCancel(value)) {
    throw new PromptCancelled();
  }
  return value as Exclude<T, symbol>;
}

const fancy = (): boolean => Boolean(process.stdout.isTTY);

/** Task emojis shown in the menu and task summaries. */
export const taskEmoji: Record<string, string> = {
  folderPull: "📂 ⏬",
  folderPush: "📂 ⏫",
  databasePull: "🥞 ⏬",
  databasePush: "🥞 ⏫",
  databaseRestore: "🥞 ⏪",
  composerPull: "🎩",
  composerPush: "🎩",
  terminal: "🌐",
  backups: "🗄️",
  doctor: "💊",
  quit: "👋",
};

/** Prefix a title with its task emoji in a terminal. */
export function withEmoji(id: string, title: string): string {
  const emoji = taskEmoji[id];
  return fancy() && emoji ? `${emoji}  ${title}` : title;
}

export const ui = {
  note(title: string, lines: string[]): void {
    if (lines.length === 0) {
      return;
    }
    if (fancy()) {
      note(lines.join("\n"), title);
    } else {
      console.log([title, ...lines.map((line) => `  ${line}`)].join("\n"));
    }
  },
  info(message: string): void {
    if (fancy()) {
      log.message(message, { symbol: "💁" });
    } else {
      console.log(message);
    }
  },
  success(message: string): void {
    if (fancy()) {
      log.message(message, { symbol: "👌" });
    } else {
      console.log(message);
    }
  },
  warn(message: string): void {
    if (fancy()) {
      log.warn(message);
    } else {
      console.warn(message);
    }
  },
  error(message: string): void {
    if (fancy()) {
      log.message(message, { symbol: "💩" });
    } else {
      console.error(message);
    }
  },
  check(check: DoctorCheck): void {
    const text = `${check.label}  ${styleText("dim", check.message)}`;
    if (!fancy()) {
      const badge = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
      console.log(`[${badge}] ${check.label}: ${check.message}`);
    } else if (check.status === "pass") {
      log.success(text);
    } else if (check.status === "warn") {
      log.warn(text);
    } else {
      log.error(text);
    }
  },
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Show what a task will do, confirm if it changes data, then run it.
 * Returns null when there was nothing to do or the user declined.
 */
export async function runPrepared(runtime: LoadedRuntime, task: PreparedTask): Promise<TaskResult | null> {
  ui.note(withEmoji(task.id, task.title), task.details);
  if (task.nothingToDo) {
    ui.info(task.nothingToDo);
    playSound("message");
    return null;
  }

  if (task.confirm && !runtime.options.force) {
    if (!runtime.options.interactive) {
      throw new Error(`${task.title} changes data and needs confirmation. Re-run with --yes to skip the prompt.`);
    }
    const proceed = await confirm({
      message: task.confirm.message,
      initialValue: task.confirm.initialValue,
    });
    if (isCancel(proceed) || !proceed) {
      ui.info("Cancelled. Nothing was changed.");
      playSound("message");
      return null;
    }
  }

  const started = Date.now();
  const result = await task.execute();
  ui.success(`${result.summary} ${styleText("dim", `(${formatDuration(Date.now() - started)})`)}`);
  playSound("success");
  for (const artifact of result.artifacts ?? []) {
    ui.info(`Backup saved to ${path.relative(runtime.options.cwd, artifact) || artifact}`);
  }
  return result;
}
