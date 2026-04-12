import { afterEach, describe, expect, test } from "bun:test";
import { inspectProject } from "../src/core/doctor";
import { cleanupTempProject, createTempProject } from "./helpers";
import { MockRunner } from "./helpers";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    await cleanupTempProject(tempDirs.pop()!);
  }
});

describe("doctor", () => {
  test("fails when tug.toml is missing", async () => {
    const cwd = await createTempProject();
    tempDirs.push(cwd);
    const report = await inspectProject(
      {
        cwd,
        force: false,
        dryRun: false,
        verbose: false,
        json: false,
        interactive: false,
      },
      new MockRunner(),
    );
    expect(report.ok).toBe(false);
    expect(report.checks[0]?.id).toBe("config");
  });
});
