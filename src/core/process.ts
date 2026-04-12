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
    const stdoutMode = spec.stdout ?? "pipe";
    const stderrMode = spec.stderr ?? "pipe";

    const child = Bun.spawn({
      cmd: command,
      cwd: spec.cwd,
      env: spec.env ? { ...process.env, ...spec.env } : process.env,
      stdin: stdinMode,
      stdout: stdoutMode,
      stderr: stderrMode,
    });

    if (typeof spec.stdin === "string" && stdinMode === "pipe" && child.stdin) {
      child.stdin.write(spec.stdin);
      child.stdin.end();
    }

    const [stdout, stderr, exitCode] = await Promise.all([
      readStream(stdoutMode === "pipe" ? (child.stdout ?? null) : null, hooks.onStdout),
      readStream(stderrMode === "pipe" ? (child.stderr ?? null) : null, hooks.onStderr),
      child.exited,
    ]);

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
