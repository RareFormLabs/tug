import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { stripVTControlCharacters as plain } from "node:util";
import { BunProcessRunner } from "../src/core/process";
import { MemoryReporter, renderProgress } from "../src/core/reporter";
import { buildDatabaseCommands, prepareRestore } from "../src/tasks/database";
import { runStep } from "../src/tasks/shared";
import type { TugConfig } from "../src/types";
import { MockRunner, cleanupTempProject, createRuntime, createTempProject, writeProjectFile } from "./helpers";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    await cleanupTempProject(tempDirs.pop()!);
  }
});

const config: TugConfig = {
  project: { disabled_tasks: [] },
  remote: { host: "example.com", user: "deploy", port: 22, app_path: "/srv/app", env_path: "/srv/app/.env" },
  files: { push: ["templates"], pull: [], exclude: [] },
  database: { engine: "mysql", local_env_file: ".env", remote_env_path: "/srv/app/.env", backup_dir: ".tug/backups" },
  composer: { enabled: false },
};

describe("progress", () => {
  test("streams a file through a command and reports bytes both ways", async () => {
    const cwd = await createTempProject();
    tempDirs.push(cwd);
    const input = path.join(cwd, "in.bin");
    const output = path.join(cwd, "out.bin");
    await Bun.write(input, new Uint8Array(300_000).fill(7));

    const runtime = createRuntime(cwd, config, new BunProcessRunner());
    await runStep(runtime, "copy", {
      command: "cat",
      stdinFile: input,
      stdoutFile: output,
      stderr: "pipe",
      progress: { kind: "stdinBytes" },
    });

    expect(Bun.file(output).size).toBe(300_000);
    const progress = (runtime.reporter as MemoryReporter).progress;
    expect(progress.at(-1)).toEqual({ done: 300_000, total: 300_000, unit: "bytes" });
  });

  test("counts displayed lines against a known total", async () => {
    const runner = new MockRunner(async (_spec, hooks) => {
      hooks?.onStdout?.("<f+++++++++ a.twig\n.d..t...... ./\n<f.st...... b.twig\n");
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const runtime = createRuntime("/tmp/project", config, runner);
    await runStep(runtime, "Push templates/", {
      command: "rsync",
      formatLine: (line) => (line.startsWith(".") ? null : line),
      progress: { kind: "lines", total: 2 },
    });
    expect((runtime.reporter as MemoryReporter).progress.at(-1)).toEqual({ done: 2, total: 2, unit: "files" });
  });

  test("renders a bar with a known total and a running amount without one", () => {
    expect(plain(renderProgress({ done: 512, total: 1024, unit: "bytes" }))).toContain("50%");
    expect(plain(renderProgress({ done: 3 * 1024 * 1024, unit: "bytes" }))).toBe("3.0 MB");
    expect(plain(renderProgress({ done: 1, unit: "files" }))).toBe("1 file");
  });

  test("database pull streams the download and import so they can show progress", async () => {
    const cwd = await createTempProject();
    tempDirs.push(cwd);
    await writeProjectFile(cwd, ".env", 'DB_DRIVER="mysql"\nDB_DATABASE="craft"\nDB_USER="root"\n');
    const runner = new MockRunner(async (spec) =>
      spec.command === "ssh" && spec.args?.at(-1)?.startsWith("cat ")
        ? { exitCode: 0, stdout: 'DB_DATABASE="remote"\nDB_USER="remote"\nDB_PASSWORD="it\'s secret"\n', stderr: "" }
        : { exitCode: 0, stdout: "", stderr: "" },
    );
    const runtime = createRuntime(cwd, config, runner);
    const { plan } = await buildDatabaseCommands(runtime, "pull");
    const byLabel = (label: string) => plan.commands.find((command) => command.display === label)!;

    expect(byLabel("Download remote dump").stdoutFile).toEndWith("pull.sql.gz");
    expect(byLabel("Import into local database").stdinFile).toEndWith("pull.sql.gz");
    expect(byLabel("Back up local database craft").progress?.kind).toBe("stdoutBytes");
    // A dump that fails halfway must fail the step, not leave a truncated file behind.
    const remoteDump = byLabel("Dump remote database remote").args!.at(-1)!;
    expect(remoteDump).toContain("set -o pipefail");
    expect(remoteDump).toStartWith("export MYSQL_PWD='it'\"'\"'s secret';");
  });

  test("a failed stream leaves no file behind, so it can't pass for a backup", async () => {
    const cwd = await createTempProject();
    tempDirs.push(cwd);
    const runner = new BunProcessRunner();
    const failed = path.join(cwd, "failed.sql.gz");
    await expect(
      runner.run({ command: "/bin/sh", args: ["-c", "printf partial; exit 3"], stdoutFile: failed, stderr: "pipe" }),
    ).rejects.toThrow("status 3");
    expect(await Bun.file(failed).exists()).toBe(false);
    expect(await Bun.file(`${failed}.partial`).exists()).toBe(false);

    const succeeded = path.join(cwd, "ok.sql.gz");
    await runner.run({ command: "/bin/sh", args: ["-c", "printf done"], stdoutFile: succeeded, stderr: "pipe" });
    expect(await Bun.file(succeeded).text()).toBe("done");
    expect(await Bun.file(`${succeeded}.partial`).exists()).toBe(false);
  });

  test("gzip -t rejects a truncated dump", async () => {
    const cwd = await createTempProject();
    tempDirs.push(cwd);
    const full = Bun.gzipSync(new TextEncoder().encode("INSERT INTO t VALUES (1);\n".repeat(2000)));
    const truncated = path.join(cwd, "truncated.sql.gz");
    await Bun.write(truncated, full.slice(0, Math.floor(full.length / 2)));
    const result = await new BunProcessRunner().run({ command: "gzip", args: ["-t", truncated], allowFailure: true });
    expect(result.exitCode).not.toBe(0);
  });
});

describe("dump checks run before any database is cleared", () => {
  const remoteEnv = async (spec: { command: string; args?: string[] }) =>
    spec.command === "ssh" && spec.args?.at(-1)?.startsWith("cat ")
      ? { exitCode: 0, stdout: 'DB_DATABASE="remote"\nDB_USER="remote"\n', stderr: "" }
      : { exitCode: 0, stdout: "", stderr: "" };

  const order = (labels: (string | undefined)[], check: string, clear: string) => {
    const checkAt = labels.indexOf(check);
    expect(checkAt).toBeGreaterThanOrEqual(0);
    expect(checkAt).toBeLessThan(labels.indexOf(clear));
  };

  test("pull, push, and restore", async () => {
    const cwd = await createTempProject();
    tempDirs.push(cwd);
    await writeProjectFile(cwd, ".env", 'DB_DRIVER="mysql"\nDB_DATABASE="craft"\nDB_USER="root"\n');
    const runtime = createRuntime(cwd, config, new MockRunner(remoteEnv));

    const pull = (await buildDatabaseCommands(runtime, "pull")).plan.commands.map((command) => command.display);
    order(pull, "Check downloaded dump", "Clear local database");

    const push = (await buildDatabaseCommands(runtime, "push")).plan.commands.map((command) => command.display);
    order(push, "Check uploaded dump", "Clear remote database");

    const dump = path.join(cwd, "backup.sql.gz");
    await Bun.write(dump, Bun.gzipSync(new TextEncoder().encode("SELECT 1;")));
    const commands: string[] = [];
    const restoreRunner = new MockRunner(async (spec) => {
      commands.push(spec.display ?? spec.command);
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const restore = await prepareRestore(createRuntime(cwd, config, restoreRunner), dump);
    await restore.execute();
    order(commands, "Check backup.sql.gz", "Clear local database");
  });
});
