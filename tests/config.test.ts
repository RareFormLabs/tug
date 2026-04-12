import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
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
    const envCopy = await readFile(`${cwd}/.env`, "utf8");
    expect(config.remote.host).toBe("example.com");
    expect(config.database.engine).toBe("mysql");
    expect(envCopy).toBe("DB_DATABASE=test\nDB_USER=root\n");
  });

  test("refuses to overwrite tug.toml without force", async () => {
    const cwd = await createTempProject();
    tempDirs.push(cwd);
    await writeProjectFile(cwd, "tug.toml", "existing = true\n");
    await expect(writeInitialConfig(cwd)).rejects.toThrow("Refusing to overwrite");
  });

  test("renders example config with project section", () => {
    const rendered = renderExampleConfig();
    expect(rendered).toContain("[project]");
    expect(rendered).toContain('engine = "mysql"');
  });
});
