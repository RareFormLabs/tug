import { afterEach, describe, expect, test } from "bun:test";
import { resolveLocalDatabaseCredentials } from "../src/core/env";
import type { TugConfig } from "../src/types";
import {
  cleanupTempProject,
  createTempProject,
  writeProjectFile,
} from "./helpers";

const tempDirs: string[] = [];

const config: TugConfig = {
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
    engine: "mysql",
    local_env_file: ".env",
    remote_env_path: "/srv/app/current/.env",
    backup_dir: ".tug/backups",
  },
  composer: { enabled: true },
};

afterEach(async () => {
  while (tempDirs.length > 0) {
    await cleanupTempProject(tempDirs.pop()!);
  }
});

describe("env resolution", () => {
  test("resolves Craft-style database variables", async () => {
    const cwd = await createTempProject();
    tempDirs.push(cwd);
    await writeProjectFile(
      cwd,
      ".env",
      'DB_DRIVER="mysql"\nDB_SERVER="127.0.0.1"\nDB_PORT="3307"\nDB_DATABASE="craft"\nDB_USER="root"\nDB_PASSWORD="secret"\n',
    );
    const credentials = await resolveLocalDatabaseCredentials(cwd, config, {
      cwd,
      force: false,
      dryRun: false,
      verbose: false,
      json: false,
      interactive: false,
    });
    expect(credentials.engine).toBe("mysql");
    expect(credentials.port).toBe(3307);
    expect(credentials.database).toBe("craft");
  });

  test("resolves DATABASE_URL", async () => {
    const cwd = await createTempProject();
    tempDirs.push(cwd);
    await writeProjectFile(
      cwd,
      ".env",
      'DATABASE_URL="postgres://craft:secret@db.internal:5432/craftdb"\n',
    );
    const credentials = await resolveLocalDatabaseCredentials(cwd, config, {
      cwd,
      force: false,
      dryRun: false,
      verbose: false,
      json: false,
      interactive: false,
    });
    expect(credentials.engine).toBe("postgres");
    expect(credentials.host).toBe("db.internal");
    expect(credentials.database).toBe("craftdb");
  });
});
