import { styleText } from "node:util";
import { log, spinner } from "@clack/prompts";
import type { Reporter } from "../types";

const DEFAULT_OUTPUT_LIMIT = 20;

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}

function truncate(text: string, width: number): string {
  if (width <= 1) {
    return "";
  }
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

/**
 * Terminal reporter: a spinner per step (showing the latest output line), then
 * the step's output once it finishes. Long output is capped unless verbose.
 */
export class TerminalReporter implements Reporter {
  constructor(private readonly verbose: boolean) {}

  async step<T>(label: string, work: (onLine: (line: string) => void) => Promise<T>): Promise<T> {
    const lines: string[] = [];
    const progress = spinner({ indicator: "timer" });
    progress.start(label);
    try {
      const result = await work((line) => {
        lines.push(line);
        const room = (process.stdout.columns ?? 80) - label.length - 16;
        progress.message(`${label}  ${styleText("dim", truncate(line, room))}`);
      });
      progress.stop(label);
      this.printOutput(lines);
      return result;
    } catch (error) {
      progress.error(label);
      throw error;
    }
  }

  private printOutput(lines: string[]): void {
    if (lines.length === 0) {
      return;
    }
    const shown = this.verbose ? lines : lines.slice(0, DEFAULT_OUTPUT_LIMIT);
    const hidden = lines.length - shown.length;
    const body = shown.map((line) => styleText("dim", line));
    if (hidden > 0) {
      body.push(styleText("dim", `… ${hidden} more line(s). Re-run with --verbose to see everything.`));
    }
    log.message(body.join("\n"), { spacing: 0 });
  }
}

/** Plain line-oriented reporter for pipes and CI logs. */
export class PlainReporter implements Reporter {
  async step<T>(label: string, work: (onLine: (line: string) => void) => Promise<T>): Promise<T> {
    const started = Date.now();
    console.log(`→ ${label}`);
    try {
      const result = await work((line) => console.log(`  ${line}`));
      console.log(`✓ ${label} (${formatDuration(Date.now() - started)})`);
      return result;
    } catch (error) {
      console.log(`✗ ${label}`);
      throw error;
    }
  }
}

/** Collects step labels and output in memory. Used by tests. */
export class MemoryReporter implements Reporter {
  readonly steps: string[] = [];
  readonly lines: string[] = [];

  async step<T>(label: string, work: (onLine: (line: string) => void) => Promise<T>): Promise<T> {
    this.steps.push(label);
    return work((line) => this.lines.push(line));
  }
}

export function createReporter(options: { verbose: boolean }): Reporter {
  return process.stdout.isTTY ? new TerminalReporter(options.verbose) : new PlainReporter();
}
