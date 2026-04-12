import { access, copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "smol-toml";
import { z } from "zod";
import { resolveConfigPath } from "./paths";
import type { RuntimeOptions, TugConfig } from "../types";

const configSchema = z.object({
  project: z
    .object({
      name: z.string().optional(),
      disabled_tasks: z.array(z.string()).default([]),
    })
    .default({ disabled_tasks: [] }),
  remote: z.object({
    host: z.string().min(1),
    user: z.string().min(1),
    port: z.number().int().positive().default(22),
    app_path: z.string().min(1),
    env_path: z.string().min(1),
  }),
  files: z.object({
    push: z.array(z.string()).default([]),
    pull: z.array(z.string()).default([]),
    exclude: z.array(z.string()).default([]),
  }),
  database: z.object({
    engine: z.enum(["mysql", "postgres"]),
    local_env_file: z.string().min(1).default(".env"),
    remote_env_path: z.string().min(1),
    backup_dir: z.string().min(1).default(".tug/backups"),
  }),
  composer: z.object({
    enabled: z.boolean().default(true),
  }),
});

const exampleConfig: TugConfig = {
  project: { name: "my-craft-site", disabled_tasks: [] },
  remote: {
    host: "example.com",
    user: "deploy",
    port: 22,
    app_path: "/srv/users/deploy/apps/site/current",
    env_path: "/srv/users/deploy/apps/site/current/.env",
  },
  files: {
    push: ["templates", "config", "web/dist"],
    pull: ["web/uploads"],
    exclude: [".DS_Store", ".git", ".env"],
  },
  database: {
    engine: "mysql",
    local_env_file: ".env",
    remote_env_path: "/srv/users/deploy/apps/site/current/.env",
    backup_dir: ".tug/backups",
  },
  composer: { enabled: true },
};

export function renderExampleConfig(): string {
  return stringify(exampleConfig);
}

export async function configExists(cwd: string, explicitPath?: string): Promise<boolean> {
  try {
    await access(resolveConfigPath(cwd, explicitPath));
    return true;
  } catch {
    return false;
  }
}

export async function readConfig(cwd: string, explicitPath?: string): Promise<TugConfig> {
  const configPath = resolveConfigPath(cwd, explicitPath);
  const raw = await readFile(configPath, "utf8");
  const parsed = parse(raw);
  return configSchema.parse(parsed);
}

export async function writeInitialConfig(
  cwd: string,
  explicitPath?: string,
  force = false,
): Promise<string> {
  const destination = resolveConfigPath(cwd, explicitPath);
  if (!force) {
    await access(destination)
      .then(() => {
        throw new Error(`Refusing to overwrite ${destination}. Re-run with --force to replace it.`);
      })
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
          throw error;
        }
      });
  }
  await writeFile(destination, renderExampleConfig(), "utf8");
  const exampleEnvSource = path.resolve(cwd, ".env.example");
  const exampleEnvTarget = path.resolve(cwd, ".env");
  try {
    await access(exampleEnvSource);
    if (!force) {
      await access(exampleEnvTarget)
        .then(() => undefined)
        .catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
            throw error;
          }
        });
      try {
        await access(exampleEnvTarget);
        return destination;
      } catch {
        // .env does not exist yet, continue.
      }
    }
    await copyFile(exampleEnvSource, exampleEnvTarget);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
      throw error;
    }
  }
  return destination;
}

export async function loadRuntimeConfig(options: RuntimeOptions): Promise<TugConfig> {
  return readConfig(options.cwd, options.configPath);
}
