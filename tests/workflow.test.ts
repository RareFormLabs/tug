import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureGitignored } from "../src/core/config";
import { findConfigPath, listBackups } from "../src/core/paths";
import { MemoryReporter } from "../src/core/reporter";
import { runPrepared } from "../src/cli/ui";
import { prepare as prepareDatabase } from "../src/tasks/database";
import { parseItemizedChanges, prepare as prepareFolder } from "../src/tasks/folder";
import { lineSplitter } from "../src/tasks/shared";
import type { PreparedTask, TugConfig } from "../src/types";
import { MockRunner, cleanupTempProject, createRuntime, createTempProject, writeProjectFile } from "./helpers";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    await cleanupTempProject(tempDirs.pop()!);
  }
});

async function tempProject(): Promise<string> {
  const cwd = await createTempProject();
  tempDirs.push(cwd);
  return cwd;
}

const config: TugConfig = {
  project: { disabled_tasks: [] },
  remote: {
    host: "example.com",
    user: "deploy",
    port: 22,
    app_path: "/srv/app/current",
    env_path: "/srv/app/current/.env",
  },
  files: { push: ["templates"], pull: ["web/uploads"], exclude: [] },
  database: {
    engine: "mysql",
    local_env_file: ".env",
    remote_env_path: "/srv/app/current/.env",
    backup_dir: ".tug/backups",
  },
  composer: { enabled: true },
};

describe("rsync change preview", () => {
  test("parses new, changed, and deleted files and ignores attribute-only lines", () => {
    const output = [
      "<f+++++++++ index.twig",
      "<f.st...... _layout.twig",
      ".d..t...... partials/",
      "cd+++++++++ blocks/",
      "*deleting   old.twig",
      "",
    ].join("\n");
    expect(parseItemizedChanges("templates", output)).toEqual([
      { folder: "templates", kind: "new", path: "index.twig" },
      { folder: "templates", kind: "changed", path: "_layout.twig" },
      { folder: "templates", kind: "new", path: "blocks/" },
      { folder: "templates", kind: "deleted", path: "old.twig" },
    ]);
  });

  test("parses macOS openrsync's shorter change codes", () => {
    const output = "*deleting old.twig\n.d..t.... ./\n<f+++++++ index.twig\n<f.st.... same.twig\n";
    expect(parseItemizedChanges("templates", output).map((change) => change.kind)).toEqual([
      "deleted",
      "new",
      "changed",
    ]);
  });

  test("push preview lists changes and asks with a default of no", async () => {
    const runner = new MockRunner(async (spec) => ({
      exitCode: 0,
      stdout: spec.args?.includes("--dry-run") ? "<f.st...... index.twig\n*deleting   old.twig\n" : "",
      stderr: "",
    }));
    const runtime = createRuntime("/tmp/project", config, runner, { force: false });
    const task = await prepareFolder(runtime, "push", { preview: true });
    expect(task.details).toContain("~ templates/index.twig");
    expect(task.details).toContain("- templates/old.twig");
    expect(task.confirm?.initialValue).toBe(false);
    expect(runner.calls).toHaveLength(1);
  });

  test("push preview with no differences has nothing to do", async () => {
    const runtime = createRuntime("/tmp/project", config, new MockRunner(), { force: false });
    const task = await prepareFolder(runtime, "push", { preview: true });
    expect(task.nothingToDo).toBeDefined();
  });

  test("pull does not ask for confirmation", async () => {
    const runtime = createRuntime("/tmp/project", config, new MockRunner(), { force: false });
    const task = await prepareFolder(runtime, "pull");
    expect(task.confirm).toBeUndefined();
  });
});

describe("runPrepared", () => {
  const task = (executed: string[]): PreparedTask => ({
    title: "Database push",
    details: [],
    confirm: { message: "Replace?", initialValue: false },
    execute: async () => {
      executed.push("ran");
      return { ok: true, summary: "done" };
    },
  });

  test("refuses destructive tasks without a terminal unless --yes is passed", async () => {
    const executed: string[] = [];
    const runtime = createRuntime("/tmp/project", config, new MockRunner(), { force: false, interactive: false });
    await expect(runPrepared(runtime, task(executed))).rejects.toThrow("--yes");
    expect(executed).toEqual([]);
  });

  test("runs without prompting when --yes is passed", async () => {
    const executed: string[] = [];
    const runtime = createRuntime("/tmp/project", config, new MockRunner(), { force: true, interactive: false });
    await runPrepared(runtime, task(executed));
    expect(executed).toEqual(["ran"]);
  });
});

describe("database prepare", () => {
  const remoteEnv = (driver: string) => async (spec: { command: string; args?: string[] }) =>
    spec.command === "ssh" && spec.args?.at(-1)?.startsWith("cat ")
      ? { exitCode: 0, stdout: `DB_DRIVER="${driver}"\nDB_DATABASE="remote"\nDB_USER="remote"\n`, stderr: "" }
      : { exitCode: 0, stdout: "", stderr: "" };

  test("does not create a backup folder until the task runs", async () => {
    const cwd = await tempProject();
    await writeProjectFile(cwd, ".env", 'DB_DRIVER="mysql"\nDB_DATABASE="craft"\nDB_USER="root"\n');
    const runtime = createRuntime(cwd, config, new MockRunner(remoteEnv("mysql")));
    const task = await prepareDatabase(runtime, "pull");
    expect(task.details.join("\n")).toContain("remote on example.com");
    expect(await listBackups(cwd, config)).toEqual([]);
    expect((runtime.reporter as MemoryReporter).steps).toEqual(["Reading database settings"]);
  });

  test("rejects syncing between different engines before changing anything", async () => {
    const cwd = await tempProject();
    await writeProjectFile(cwd, ".env", 'DB_DRIVER="mysql"\nDB_DATABASE="craft"\nDB_USER="root"\n');
    const runtime = createRuntime(cwd, config, new MockRunner(remoteEnv("pgsql")));
    await expect(prepareDatabase(runtime, "pull")).rejects.toThrow("can only sync matching engines");
  });
});

describe("project helpers", () => {
  test("finds tug.toml in a parent folder", async () => {
    const cwd = await tempProject();
    await writeProjectFile(cwd, "tug.toml", "");
    const nested = path.join(cwd, "templates", "partials");
    await mkdir(nested, { recursive: true });
    expect(await findConfigPath(nested)).toBe(path.join(cwd, "tug.toml"));
  });

  test("adds .tug/ to an existing .gitignore once", async () => {
    const cwd = await tempProject();
    await writeProjectFile(cwd, ".gitignore", "vendor");
    expect(await ensureGitignored(cwd)).toBe(true);
    expect(await ensureGitignored(cwd)).toBe(false);
    expect(await readFile(path.join(cwd, ".gitignore"), "utf8")).toBe("vendor\n.tug/\n");
  });

  test("lists backups newest first and skips empty snapshots", async () => {
    const cwd = await tempProject();
    const root = path.join(cwd, ".tug", "backups");
    for (const token of ["20260101-090000", "20260301-090000", "20260201-090000"]) {
      await mkdir(path.join(root, token), { recursive: true });
      if (token !== "20260201-090000") {
        await writeFile(path.join(root, token, "local-before-pull.sql.gz"), "x");
      }
    }
    const snapshots = await listBackups(cwd, config);
    expect(snapshots.map((snapshot) => snapshot.token)).toEqual(["20260301-090000", "20260101-090000"]);
  });

  test("splits streamed chunks into lines", () => {
    const lines: string[] = [];
    const splitter = lineSplitter((line) => lines.push(line));
    splitter.push("first\nsec");
    splitter.push("ond\r\n\nthird");
    splitter.flush();
    expect(lines).toEqual(["first", "second", "third"]);
  });
});
