import path from "node:path";

export type SoundName = "start" | "success" | "error" | "message";

const files: Record<SoundName, string> = {
  start: "start.mp3",
  success: "success.wav",
  error: "error.wav",
  message: "message.wav",
};

const soundsDir = path.resolve(import.meta.dir, "../../resources/sounds");

let enabled = process.env.TUG_SOUNDS !== "0";

/** Turn sounds off for the rest of the run (`[project] sounds = false` in tug.toml). */
export function setSoundsEnabled(value: boolean): void {
  enabled = value && process.env.TUG_SOUNDS !== "0";
}

/**
 * Play a short notification sound without waiting for it. macOS only (afplay),
 * and only when a person is watching a terminal.
 */
export function playSound(name: SoundName): void {
  if (!enabled || process.platform !== "darwin" || !process.stdout.isTTY) {
    return;
  }
  try {
    Bun.spawn({
      cmd: ["afplay", path.join(soundsDir, files[name])],
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    }).unref();
  } catch {
    // A missing player shouldn't break anything.
  }
}
