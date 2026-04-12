import { describe, expect, test } from "bun:test";
import { BunProcessRunner } from "../src/core/process";

describe("process runner", () => {
  test("merges custom env with PATH for spawned commands", async () => {
    const runner = new BunProcessRunner();
    const result = await runner.run({
      command: process.env.SHELL ?? "/bin/sh",
      args: ["-lc", "printf '%s\n' \"$TUG_TEST_ENV\" && which ls"],
      env: {
        TUG_TEST_ENV: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("1");
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });
});
