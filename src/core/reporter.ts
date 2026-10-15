import { styleText } from "node:util";
import { log, spinner } from "@clack/prompts";
import { formatDuration, formatSize } from "./format";
import type { Reporter, StepContext, StepProgress } from "../types";

const DEFAULT_OUTPUT_LIMIT = 20;
const BAR_WIDTH = 24;
const REDRAW_INTERVAL_MS = 100;

export { formatDuration };

function truncate(text: string, width: number): string {
  if (width <= 1) {
    return "";
  }
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

function formatAmount(value: number, unit: StepProgress["unit"]): string {
  return unit === "bytes" ? formatSize(value) : `${value} file${value === 1 ? "" : "s"}`;
}

/**
 * `━━━━━━━━━━──────────────  42%  12.3 MB / 29.0 MB`, or just the running amount
 * when the total isn't known.
 */
export function renderProgress(progress: StepProgress): string {
  if (!progress.total) {
    return formatAmount(progress.done, progress.unit);
  }
  const ratio = Math.min(1, progress.done / progress.total);
  const filled = Math.round(ratio * BAR_WIDTH);
  const bar = `${styleText("cyan", "━".repeat(filled))}${styleText("dim", "─".repeat(BAR_WIDTH - filled))}`;
  const percent = `${Math.floor(ratio * 100)}%`.padStart(4);
  const amount =
    progress.unit === "bytes"
      ? `${formatSize(progress.done)} / ${formatSize(progress.total)}`
      : `${progress.done} / ${progress.total} files`;
  return `${bar} ${percent}  ${styleText("dim", amount)}`;
}

/**
 * Terminal reporter: a spinner per step that shows a progress bar when the step
 * reports progress (or its latest output line otherwise), then the step's output
 * once it finishes. Long output is capped unless verbose.
 */
export class TerminalReporter implements Reporter {
  constructor(private readonly verbose: boolean) {}

  async step<T>(label: string, work: (context: StepContext) => Promise<T>): Promise<T> {
    const lines: string[] = [];
    const indicator = spinner({ indicator: "timer" });
    let latestLine = "";
    let latestProgress: StepProgress | null = null;
    let lastDraw = 0;

    const redraw = (): void => {
      const now = Date.now();
      if (now - lastDraw < REDRAW_INTERVAL_MS) {
        return;
      }
      lastDraw = now;
      if (latestProgress) {
        indicator.message(`${label}  ${renderProgress(latestProgress)}`);
      } else if (latestLine) {
        const room = (process.stdout.columns ?? 80) - label.length - 16;
        indicator.message(`${label}  ${styleText("dim", truncate(latestLine, room))}`);
      }
    };

    indicator.start(label);
    try {
      const result = await work({
        line: (text) => {
          lines.push(text);
          latestLine = text;
          redraw();
        },
        progress: (progress) => {
          latestProgress = progress;
          redraw();
        },
      });
      const finished = latestProgress as StepProgress | null;
      indicator.stop(finished ? `${label}  ${styleText("dim", formatAmount(finished.done, finished.unit))}` : label);
      this.printOutput(lines);
      return result;
    } catch (error) {
      indicator.error(label);
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
  async step<T>(label: string, work: (context: StepContext) => Promise<T>): Promise<T> {
    const started = Date.now();
    let latestProgress: StepProgress | null = null;
    console.log(`→ ${label}`);
    try {
      const result = await work({
        line: (text) => console.log(`  ${text}`),
        progress: (progress) => {
          latestProgress = progress;
        },
      });
      const finished = latestProgress as StepProgress | null;
      const amount = finished ? `, ${formatAmount(finished.done, finished.unit)}` : "";
      console.log(`✓ ${label} (${formatDuration(Date.now() - started)}${amount})`);
      return result;
    } catch (error) {
      console.log(`✗ ${label}`);
      throw error;
    }
  }
}

/** Collects step labels, output, and progress in memory. Used by tests. */
export class MemoryReporter implements Reporter {
  readonly steps: string[] = [];
  readonly lines: string[] = [];
  readonly progress: StepProgress[] = [];

  async step<T>(label: string, work: (context: StepContext) => Promise<T>): Promise<T> {
    this.steps.push(label);
    return work({
      line: (text) => this.lines.push(text),
      progress: (progress) => this.progress.push(progress),
    });
  }
}

export function createReporter(options: { verbose: boolean }): Reporter {
  return process.stdout.isTTY ? new TerminalReporter(options.verbose) : new PlainReporter();
}
