import path from "node:path";
import dotenv from "dotenv";
import type {
  DatabaseCredentials,
  DatabaseEngine,
  ProcessRunner,
  RuntimeOptions,
  TugConfig,
} from "../types";

function normalizeEngine(engine: string | undefined): DatabaseEngine | null {
  if (!engine) {
    return null;
  }

  const value = engine.toLowerCase();
  if (value === "mysql" || value === "mariadb") {
    return "mysql";
  }
  if (value === "postgres" || value === "postgresql" || value === "pgsql") {
    return "postgres";
  }
  return null;
}

function parseDatabaseUrl(urlString: string): DatabaseCredentials {
  const url = new URL(urlString);
  const engine = normalizeEngine(url.protocol.replace(":", ""));
  if (!engine) {
    throw new Error(`Unsupported DATABASE_URL protocol: ${url.protocol}`);
  }

  return {
    engine,
    host: url.hostname,
    port: url.port ? Number(url.port) : engine === "mysql" ? 3306 : 5432,
    database: url.pathname.replace(/^\//, ""),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    url: urlString,
  };
}

function parseCraftStyleEnv(
  source: Record<string, string | undefined>,
  fallbackEngine: DatabaseEngine,
): DatabaseCredentials {
  const envEngine = normalizeEngine(source.DB_DRIVER) ?? fallbackEngine;
  const port = Number(source.DB_PORT ?? (envEngine === "mysql" ? 3306 : 5432));
  const database = source.DB_DATABASE;
  const user = source.DB_USER;
  const password = source.DB_PASSWORD ?? "";
  const host = source.DB_SERVER ?? "127.0.0.1";

  if (!database || !user) {
    throw new Error("Missing DB_DATABASE or DB_USER in environment");
  }

  return {
    engine: envEngine,
    host,
    port,
    database,
    user,
    password,
  };
}

export async function readLocalEnv(
  cwd: string,
  config: TugConfig,
  options: RuntimeOptions,
): Promise<Record<string, string | undefined>> {
  const envPath = path.resolve(cwd, options.envFile ?? config.database.local_env_file);
  try {
    const content = await Bun.file(envPath).text();
    return dotenv.parse(content);
  } catch {
    return {};
  }
}

export async function resolveLocalDatabaseCredentials(
  cwd: string,
  config: TugConfig,
  options: RuntimeOptions,
): Promise<DatabaseCredentials> {
  const localEnv = await readLocalEnv(cwd, config, options);
  const urlValue = process.env.DATABASE_URL ?? localEnv.DATABASE_URL;
  if (urlValue) {
    return parseDatabaseUrl(urlValue);
  }

  return parseCraftStyleEnv(
    {
      DB_DRIVER: process.env.DB_DRIVER ?? localEnv.DB_DRIVER,
      DB_SERVER: process.env.DB_SERVER ?? localEnv.DB_SERVER,
      DB_PORT: process.env.DB_PORT ?? localEnv.DB_PORT,
      DB_DATABASE: process.env.DB_DATABASE ?? localEnv.DB_DATABASE,
      DB_USER: process.env.DB_USER ?? localEnv.DB_USER,
      DB_PASSWORD: process.env.DB_PASSWORD ?? localEnv.DB_PASSWORD,
    },
    config.database.engine,
  );
}

export async function fetchRemoteEnv(
  config: TugConfig,
  runner: ProcessRunner,
): Promise<Record<string, string | undefined>> {
  const result = await runner.run({
    command: "ssh",
    args: [
      "-p",
      String(config.remote.port),
      `${config.remote.user}@${config.remote.host}`,
      `cat ${config.database.remote_env_path || config.remote.env_path}`,
    ],
    stdout: "pipe",
    stderr: "pipe",
    display: `ssh ${config.remote.user}@${config.remote.host} cat ${config.database.remote_env_path}`,
  });
  return dotenv.parse(result.stdout);
}

export async function resolveRemoteDatabaseCredentials(
  config: TugConfig,
  runner: ProcessRunner,
): Promise<DatabaseCredentials> {
  const remoteEnv = await fetchRemoteEnv(config, runner);
  const urlValue = remoteEnv.DATABASE_URL;
  if (urlValue) {
    return parseDatabaseUrl(urlValue);
  }

  return parseCraftStyleEnv(remoteEnv, config.database.engine);
}
