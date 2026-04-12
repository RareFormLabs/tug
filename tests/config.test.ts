import { afterEach, describe, expect, test } from "bun:test";
import { readConfig, renderExampleConfig, writeInitialConfig } from "../src/core/config";
import {
  cleanupTempProject,
  createTempProject,
  writeProjectFile,
} from "./helpers";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    await cleanupTempProject(tempDirs.pop()!);
  }
});

describe("config", () => {
  test("writes and reads tug.toml", async () => {
    const cwd = await createTempProject();
    tempDirs.push(cwd);
    await writeProjectFile(cwd, ".env.example", "DB_DATABASE=test\nDB_USER=root\n");
    await writeInitialConfig(cwd);
    const config = await readConfig(cwd);
    expect(config.remote.host).toBe("example.com");
    expect(config.database.engine).toBe("mysql");
  });

  test("renders example config with project section", () => {
    const rendered = renderExampleConfig();
    expect(rendered).toContain("[project]");
    expect(rendered).toContain('engine = "mysql"');
  });
});
