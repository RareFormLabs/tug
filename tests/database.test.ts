import { afterEach, describe, expect, test } from "bun:test";
import { buildDatabaseCommands, doctor as databaseDoctor } from "../src/tasks/database";
import type { TugConfig } from "../src/types";
import {
  MockRunner,
  cleanupTempProject,
  createRuntime,
  createTempProject,
  writeProjectFile,
} from "./helpers";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    await cleanupTempProject(tempDirs.pop()!);
  }
});

function createConfig(engine: "mysql" | "postgres"): TugConfig {
  return {
    project: { disabled_tasks: [] },
    remote: {
      host: "example.com",
      user: "deploy",
      port: 22,
      app_path: "/srv/app/current",
      env_path: "/srv/app/current/.env",
    },
    files: { push: [], pull: [], exclude: [] },
    database: {
      engine,
      local_env_file: ".env",
      remote_env_path: "/srv/app/current/.env",
      backup_dir: ".tug/backups",
    },
    composer: { enabled: true },
  };
}

describe("database orchestration", () => {
  test("builds mysql pull commands from local and remote env", async () => {
    const cwd = await createTempProject();
    tempDirs.push(cwd);
    await writeProjectFile(
      cwd,
      ".env",
      'DB_DRIVER="mysql"\nDB_SERVER="127.0.0.1"\nDB_PORT="3306"\nDB_DATABASE="craft"\nDB_USER="root"\nDB_PASSWORD="secret"\n',
    );
    const runner = new MockRunner(async (spec) => {
      if (spec.command === "ssh" && spec.args?.at(-1)?.startsWith("cat ")) {
        return {
          exitCode: 0,
          stdout:
            'DB_DRIVER="mysql"\nDB_SERVER="127.0.0.1"\nDB_PORT="3306"\nDB_DATABASE="remote_craft"\nDB_USER="remote"\nDB_PASSWORD="remote-secret"\n',
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const runtime = createRuntime(cwd, createConfig("mysql"), runner);
    const built = await buildDatabaseCommands(runtime, "pull");
    expect(built.plan.commands.some((command) => command.display === "import pulled database")).toBe(
      true,
    );
    expect(built.plan.commands.some((command) => command.display === "backup local database")).toBe(
      true,
    );
  });

  test("builds postgres push commands from DATABASE_URL", async () => {
    const cwd = await createTempProject();
    tempDirs.push(cwd);
    await writeProjectFile(
      cwd,
      ".env",
      'DATABASE_URL="postgres://craft:secret@localhost:5432/craftdb"\n',
    );
    const runner = new MockRunner(async (spec) => {
      if (spec.command === "ssh" && spec.args?.at(-1)?.startsWith("cat ")) {
        return {
          exitCode: 0,
          stdout: 'DATABASE_URL="postgres://remote:remote-secret@db.internal:5432/remotedb"\n',
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const runtime = createRuntime(cwd, createConfig("postgres"), runner);
    const built = await buildDatabaseCommands(runtime, "push");
    expect(built.plan.commands.some((command) => command.display === "upload local database dump")).toBe(
      true,
    );
    expect(
      built.plan.commands.some((command) => command.command === "ssh" && command.args?.at(-1)?.includes("psql")),
    ).toBe(true);
  });

  test("fails fast with clear local prerequisite error", async () => {
    const cwd = await createTempProject();
    tempDirs.push(cwd);
    await writeProjectFile(
      cwd,
      ".env",
      'DB_DRIVER="mysql"\nDB_SERVER="127.0.0.1"\nDB_PORT="3306"\nDB_DATABASE="craft"\nDB_USER="root"\nDB_PASSWORD="secret"\n',
    );
    const runner = new MockRunner(async (spec) => {
      if (spec.command === "ssh" && spec.args?.at(-1)?.startsWith("cat ")) {
        return {
          exitCode: 0,
          stdout:
            'DB_DRIVER="mysql"\nDB_SERVER="127.0.0.1"\nDB_PORT="3306"\nDB_DATABASE="remote_craft"\nDB_USER="remote"\nDB_PASSWORD="remote-secret"\n',
          stderr: "",
        };
      }
      if (spec.command === "/usr/bin/env" && spec.args?.[0] === "which") {
        if (spec.args[1] === "mysqldump") {
          return { exitCode: 1, stdout: "", stderr: "" };
        }
        return { exitCode: 0, stdout: "/usr/bin/mysql\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const runtime = createRuntime(cwd, createConfig("mysql"), runner);
    await expect(buildDatabaseCommands(runtime, "pull")).rejects.toThrow(
      "Local database prerequisite missing: mysqldump is not installed or not on PATH.",
    );
  });

  test("db doctor reports local and remote tool readiness", async () => {
    const cwd = await createTempProject();
    tempDirs.push(cwd);
    await writeProjectFile(
      cwd,
      ".env",
      'DB_DRIVER="mysql"\nDB_SERVER="127.0.0.1"\nDB_PORT="3306"\nDB_DATABASE="craft"\nDB_USER="root"\nDB_PASSWORD="secret"\n',
    );
    const runner = new MockRunner(async (spec) => {
      if (spec.command === "ssh" && spec.args?.at(-1)?.startsWith("cat ")) {
        return {
          exitCode: 0,
          stdout:
            'DB_DRIVER="mysql"\nDB_SERVER="db.internal"\nDB_PORT="3306"\nDB_DATABASE="remote_craft"\nDB_USER="remote"\nDB_PASSWORD="remote-secret"\n',
          stderr: "",
        };
      }
      if (spec.command === "/usr/bin/env" && spec.args?.[0] === "which") {
        return { exitCode: 0, stdout: `/usr/bin/${spec.args[1]}\n`, stderr: "" };
      }
      if (spec.command === "ssh" && spec.args?.at(-1)?.includes("command -v")) {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const runtime = createRuntime(cwd, createConfig("mysql"), runner);
    const report = await databaseDoctor(runtime);
    expect(report.ok).toBe(true);
    expect(report.checks.some((check) => check.id === "db-local-tool-mysqldump")).toBe(true);
    expect(report.checks.some((check) => check.id === "db-remote-tool-mysql")).toBe(true);
  });
});
