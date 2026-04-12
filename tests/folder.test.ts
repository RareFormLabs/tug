import { describe, expect, test } from "bun:test";
import { buildFolderPullCommands, buildFolderPushCommands } from "../src/tasks/folder";
import type { TugConfig } from "../src/types";
import { MockRunner, createRuntime } from "./helpers";

const config: TugConfig = {
  project: { disabled_tasks: [] },
  remote: {
    host: "example.com",
    user: "deploy",
    port: 22,
    app_path: "/srv/app/current",
    env_path: "/srv/app/current/.env",
  },
  files: {
    push: ["templates", "config"],
    pull: ["web/uploads"],
    exclude: [".cache"],
  },
  database: {
    engine: "mysql",
    local_env_file: ".env",
    remote_env_path: "/srv/app/current/.env",
    backup_dir: ".tug/backups",
  },
  composer: { enabled: true },
};

describe("folder commands", () => {
  test("builds push commands with delete and excludes", () => {
    const runtime = createRuntime("/tmp/project", config, new MockRunner());
    const commands = buildFolderPushCommands(runtime);
    expect(commands).toHaveLength(2);
    expect(commands[0]?.args).toContain("--delete");
    expect(commands[0]?.args).toContain("--exclude=.cache");
  });

  test("builds pull commands without delete", () => {
    const runtime = createRuntime("/tmp/project", config, new MockRunner(), { dryRun: true });
    const commands = buildFolderPullCommands(runtime);
    expect(commands[0]?.command).toBe("rsync");
    expect(commands[0]?.args).not.toContain("--delete");
    expect(commands[0]?.args).toContain("--dry-run");
  });
});
