import { rename, rm } from "node:fs/promises";
import { joinCommand } from "./shell";
import type {
  CommandHooks,
  CommandResult,
  CommandSpec,
  ProcessRunner,
} from "../types";

async function readStream(
  stream: ReadableStream<Uint8Array> | null,
  onText?: (text: string) => void,
): Promise<string> {
  if (!stream) {
    return "";
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      text += decoder.decode();
      break;
    }

    const next = decoder.decode(chunk.value, { stream: true });
    text += next;
    onText?.(next);
  }

  return text;
}

/** A readable stream of `filePath` that reports the running byte count as it is consumed. */
function countingFileStream(filePath: string, onBytes?: (bytes: number) => void): ReadableStream<Uint8Array> {
  let total = 0;
  return Bun.file(filePath)
    .stream()
    .pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          total += chunk.byteLength;
          onBytes?.(total);
          controller.enqueue(chunk);
        },
      }),
    );
}

/** Copy a binary stream into a file, reporting the running byte count. */
async function writeStreamToFile(
  stream: ReadableStream<Uint8Array> | null,
  filePath: string,
  onBytes?: (bytes: number) => void,
): Promise<void> {
  const writer = Bun.file(filePath).writer();
  let total = 0;
  try {
    if (stream) {
      for await (const chunk of stream) {
        // A full buffer returns a Promise; waiting on it keeps large dumps out of memory.
        const pending = writer.write(chunk);
        if (pending instanceof Promise) {
          await pending;
        }
        total += chunk.byteLength;
        onBytes?.(total);
      }
    }
  } finally {
    await writer.end();
  }
}

export class BunProcessRunner implements ProcessRunner {
  async run(spec: CommandSpec, hooks: CommandHooks = {}): Promise<CommandResult> {
    const selectedShell = process.env.SHELL ?? "/bin/sh";
    const command = spec.shell
      ? [selectedShell, "-lc", spec.command]
      : [spec.command, ...(spec.args ?? [])];
    const stdinMode =
      typeof spec.stdin === "string" && spec.stdin !== "inherit" && spec.stdin !== "pipe"
        ? "pipe"
        : (spec.stdin ?? "pipe");
    const stdoutMode = spec.stdoutFile ? "pipe" : (spec.stdout ?? "pipe");
    const stderrMode = spec.stderr ?? "pipe";

    const child = Bun.spawn({
      cmd: command,
      cwd: spec.cwd,
      env: spec.env ? { ...process.env, ...spec.env } : process.env,
      stdin: spec.stdinFile ? countingFileStream(spec.stdinFile, hooks.onStdinBytes) : stdinMode,
      stdout: stdoutMode,
      stderr: stderrMode,
    });

    if (!spec.stdinFile && typeof spec.stdin === "string" && stdinMode === "pipe" && child.stdin) {
      child.stdin.write(spec.stdin);
      child.stdin.end();
    }

    const stdoutStream = stdoutMode === "pipe" ? (child.stdout ?? null) : null;
    // Stream into a ".partial" file and only give it its real name once the command
    // succeeds, so an interrupted download never looks like a complete backup.
    const partialFile = spec.stdoutFile ? `${spec.stdoutFile}.partial` : undefined;
    let stdout: string;
    let stderr: string;
    let exitCode: number;
    try {
      [stdout, stderr, exitCode] = await Promise.all([
        partialFile
          ? writeStreamToFile(stdoutStream, partialFile, hooks.onStdoutBytes).then(() => "")
          : readStream(stdoutStream, hooks.onStdout),
        readStream(stderrMode === "pipe" ? (child.stderr ?? null) : null, hooks.onStderr),
        child.exited,
      ]);
    } catch (error) {
      if (partialFile) {
        await rm(partialFile, { force: true });
      }
      throw error;
    }
    if (partialFile && spec.stdoutFile) {
      if (exitCode === 0) {
        await rename(partialFile, spec.stdoutFile);
      } else {
        await rm(partialFile, { force: true });
      }
    }

    const result = { exitCode, stdout, stderr };
    if (exitCode !== 0 && !spec.allowFailure) {
      const rendered = spec.display ?? joinCommand(command);
      throw new Error(`${rendered} exited with status ${exitCode}\n${stderr || stdout}`.trim());
    }

    return result;
  }
}

export async function commandExists(runner: ProcessRunner, tool: string): Promise<boolean> {
  try {
    const result = await runner.run({
      command: "/usr/bin/env",
      args: ["which", tool],
      stdout: "pipe",
      stderr: "pipe",
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
