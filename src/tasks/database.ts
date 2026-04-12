import path from "node:path";
import type {
  CommandSpec,
  DatabaseAction,
  DatabaseCredentials,
  DatabaseEngine,
  DoctorCheck,
  LoadedRuntime,
  TaskPlan,
  TaskResult,
} from "../types";
import { resolveLocalDatabaseCredentials, resolveRemoteDatabaseCredentials } from "../core/env";
import { createBackupSession } from "../core/paths";
import { commandExists } from "../core/process";
import { shellQuote } from "../core/shell";
import { ensureForceForDestructive, ensureTaskEnabled, executePlan, ok } from "./shared";

const dropMysqlTablesSql =
  "SET FOREIGN_KEY_CHECKS = 0;SET GROUP_CONCAT_MAX_LEN=32768;SET @tables = NULL;SELECT GROUP_CONCAT(CONCAT('`', table_name, '`')) INTO @tables FROM information_schema.tables WHERE table_schema = DATABASE();SET @tables = IFNULL(@tables, '');SET @stmt = IF(@tables = '', 'SELECT 1', CONCAT('DROP TABLE IF EXISTS ', @tables));PREPARE stmt FROM @stmt;EXECUTE stmt;DEALLOCATE PREPARE stmt;SET FOREIGN_KEY_CHECKS = 1;";

function mysqlEnv(password: string): Record<string, string> {
  return { MYSQL_PWD: password };
}

function postgresEnv(password: string): Record<string, string> {
  return { PGPASSWORD: password };
}

function mysqlDumpSpec(credentials: DatabaseCredentials, outputPath: string, label: string): CommandSpec {
  return {
    command:
      `mysqldump --host=${shellQuote(credentials.host)} --port=${credentials.port} --user=${shellQuote(credentials.user)} --lock-tables=false --no-tablespaces --column-statistics=0 ${shellQuote(credentials.database)} | gzip > ${shellQuote(outputPath)}`,
    shell: true,
    env: mysqlEnv(credentials.password),
    stdout: "pipe",
    stderr: "pipe",
    display: label,
  };
}

function mysqlImportSpec(credentials: DatabaseCredentials, inputPath: string, label: string): CommandSpec {
  return {
    command:
      `gzip -dc ${shellQuote(inputPath)} | mysql --host=${shellQuote(credentials.host)} --port=${credentials.port} --user=${shellQuote(credentials.user)} ${shellQuote(credentials.database)}`,
    shell: true,
    env: mysqlEnv(credentials.password),
    stdout: "pipe",
    stderr: "pipe",
    display: label,
  };
}

function mysqlClearSpec(credentials: DatabaseCredentials, label: string): CommandSpec {
  return {
    command: "mysql",
    args: [
      `--host=${credentials.host}`,
      `--port=${credentials.port}`,
      `--user=${credentials.user}`,
      credentials.database,
      "-e",
      dropMysqlTablesSql,
    ],
    env: mysqlEnv(credentials.password),
    stdout: "pipe",
    stderr: "pipe",
    display: label,
  };
}

function postgresDumpSpec(credentials: DatabaseCredentials, outputPath: string, label: string): CommandSpec {
  return {
    command:
      `pg_dump --clean --if-exists --no-owner --no-privileges --host=${shellQuote(credentials.host)} --port=${credentials.port} --username=${shellQuote(credentials.user)} ${shellQuote(credentials.database)} | gzip > ${shellQuote(outputPath)}`,
    shell: true,
    env: postgresEnv(credentials.password),
    stdout: "pipe",
    stderr: "pipe",
    display: label,
  };
}

function postgresImportSpec(credentials: DatabaseCredentials, inputPath: string, label: string): CommandSpec {
  return {
    command:
      `gzip -dc ${shellQuote(inputPath)} | psql --host=${shellQuote(credentials.host)} --port=${credentials.port} --username=${shellQuote(credentials.user)} --dbname=${shellQuote(credentials.database)} --set ON_ERROR_STOP=on`,
    shell: true,
    env: postgresEnv(credentials.password),
    stdout: "pipe",
    stderr: "pipe",
    display: label,
  };
}

function postgresClearSpec(credentials: DatabaseCredentials, label: string): CommandSpec {
  return {
    command: "psql",
    args: [
      `--host=${credentials.host}`,
      `--port=${credentials.port}`,
      `--username=${credentials.user}`,
      `--dbname=${credentials.database}`,
      "--set",
      "ON_ERROR_STOP=on",
      "-c",
      "DROP SCHEMA public CASCADE; CREATE SCHEMA public;",
    ],
    env: postgresEnv(credentials.password),
    stdout: "pipe",
    stderr: "pipe",
    display: label,
  };
}

function dumpSpec(engine: DatabaseEngine, credentials: DatabaseCredentials, outputPath: string, label: string): CommandSpec {
  return engine === "mysql"
    ? mysqlDumpSpec(credentials, outputPath, label)
    : postgresDumpSpec(credentials, outputPath, label);
}

function importSpec(engine: DatabaseEngine, credentials: DatabaseCredentials, inputPath: string, label: string): CommandSpec {
  return engine === "mysql"
    ? mysqlImportSpec(credentials, inputPath, label)
    : postgresImportSpec(credentials, inputPath, label);
}

function clearSpec(engine: DatabaseEngine, credentials: DatabaseCredentials, label: string): CommandSpec {
  return engine === "mysql"
    ? mysqlClearSpec(credentials, label)
    : postgresClearSpec(credentials, label);
}

function sshCommand(runtime: LoadedRuntime, remoteScript: string, env?: Record<string, string>): CommandSpec {
  const prefix = env
    ? `${Object.entries(env)
        .map(([key, value]) => `${key}=${shellQuote(value ?? "")}`)
        .join(" ")} `
    : "";
  return {
    command: "ssh",
    args: [
      "-p",
      String(runtime.config.remote.port),
      `${runtime.config.remote.user}@${runtime.config.remote.host}`,
      `${prefix}${remoteScript}`,
    ],
    stdout: "pipe",
    stderr: "pipe",
  };
}

function rsyncCopyFromRemote(runtime: LoadedRuntime, from: string, to: string, label: string): CommandSpec {
  return {
    command: "rsync",
    args: [
      "--archive",
      `--rsh=ssh -p ${runtime.config.remote.port}`,
      `${runtime.config.remote.user}@${runtime.config.remote.host}:${from}`,
      to,
    ],
    stdout: "pipe",
    stderr: "pipe",
    display: label,
  };
}

function rsyncCopyToRemote(runtime: LoadedRuntime, from: string, to: string, label: string): CommandSpec {
  return {
    command: "rsync",
    args: [
      "--archive",
      `--rsh=ssh -p ${runtime.config.remote.port}`,
      from,
      `${runtime.config.remote.user}@${runtime.config.remote.host}:${to}`,
    ],
    stdout: "pipe",
    stderr: "pipe",
    display: label,
  };
}

function remoteTempPath(runtime: LoadedRuntime, fileName: string): string {
  return path.posix.join(runtime.config.remote.app_path, ".tug", "tmp", fileName);
}

async function remoteCommandExists(
  runtime: LoadedRuntime,
  tool: string,
): Promise<boolean> {
  const result = await runtime.runner.run({
    command: "ssh",
    args: [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=2",
      "-o",
      "NumberOfPasswordPrompts=0",
      "-o",
      "PreferredAuthentications=publickey",
      "-p",
      String(runtime.config.remote.port),
      `${runtime.config.remote.user}@${runtime.config.remote.host}`,
      `command -v ${tool} >/dev/null 2>&1`,
    ],
    stdout: "pipe",
    stderr: "pipe",
    allowFailure: true,
    display: `check remote tool ${tool}`,
  });
  return result.exitCode === 0;
}

function toolsFor(
  engine: DatabaseEngine,
  side: "local" | "remote",
  action: DatabaseAction,
): string[] {
  if (engine === "mysql") {
    if (side === "local") {
      return action === "pull" ? ["mysqldump", "mysql"] : ["mysqldump"];
    }
    return action === "pull" ? ["mysqldump"] : ["mysqldump", "mysql"];
  }

  if (side === "local") {
    return action === "pull" ? ["pg_dump", "psql"] : ["pg_dump"];
  }
  return action === "pull" ? ["pg_dump"] : ["pg_dump", "psql"];
}

async function assertDatabasePrereqs(
  runtime: LoadedRuntime,
  localEngine: DatabaseEngine,
  remoteEngine: DatabaseEngine,
  action: DatabaseAction,
): Promise<void> {
  for (const tool of toolsFor(localEngine, "local", action)) {
    const exists = await commandExists(runtime.runner, tool);
    if (!exists) {
      throw new Error(`Local database prerequisite missing: ${tool} is not installed or not on PATH.`);
    }
  }

  for (const tool of toolsFor(remoteEngine, "remote", action)) {
    const exists = await remoteCommandExists(runtime, tool);
    if (!exists) {
      throw new Error(
        `Remote database prerequisite missing: ${tool} is not installed or not on PATH for ${runtime.config.remote.user}@${runtime.config.remote.host}.`,
      );
    }
  }
}

export async function buildDatabaseCommands(
  runtime: LoadedRuntime,
  action: DatabaseAction,
): Promise<{ plan: TaskPlan; artifacts: string[] }> {
  const taskId = action === "push" ? "databasePush" : "databasePull";
  ensureTaskEnabled(runtime.config, taskId);

  const session = await createBackupSession(runtime.options.cwd, runtime.config);
  const localCreds = await resolveLocalDatabaseCredentials(
    runtime.options.cwd,
    runtime.config,
    runtime.options,
  );
  const remoteCreds = await resolveRemoteDatabaseCredentials(runtime.config, runtime.runner);
  await assertDatabasePrereqs(runtime, localCreds.engine, remoteCreds.engine, action);
  const localBackup = path.resolve(session.backupDir, `local-${action === "push" ? "before-push" : "before-pull"}.sql.gz`);
  const remoteBackup = path.resolve(session.backupDir, `remote-${action === "push" ? "before-push" : "source"}.sql.gz`);
  const localTemp = path.resolve(session.tempDir, `${action}.sql.gz`);
  const remoteTemp = remoteTempPath(runtime, `${session.token}-${action}.sql.gz`);
  const remoteBackupTemp = remoteTempPath(runtime, `${session.token}-backup.sql.gz`);

  const ensureRemoteTmp = sshCommand(
    runtime,
    `mkdir -p ${shellQuote(path.posix.dirname(remoteTemp))}`,
  );

  const commands: CommandSpec[] =
    action === "pull"
      ? [
          ensureRemoteTmp,
          sshCommand(
            runtime,
            dumpSpec(remoteCreds.engine, remoteCreds, remoteTemp, "remote dump").command,
            remoteCreds.engine === "mysql" ? mysqlEnv(remoteCreds.password) : postgresEnv(remoteCreds.password),
          ),
          rsyncCopyFromRemote(runtime, remoteTemp, localTemp, "download remote database dump"),
          sshCommand(runtime, `rm -f ${shellQuote(remoteTemp)}`),
          dumpSpec(localCreds.engine, localCreds, localBackup, "backup local database"),
          clearSpec(localCreds.engine, localCreds, "clear local database"),
          importSpec(localCreds.engine, localCreds, localTemp, "import pulled database"),
        ]
      : [
          ensureRemoteTmp,
          dumpSpec(localCreds.engine, localCreds, localBackup, "backup local database"),
          sshCommand(
            runtime,
            dumpSpec(remoteCreds.engine, remoteCreds, remoteBackupTemp, "backup remote database").command,
            remoteCreds.engine === "mysql" ? mysqlEnv(remoteCreds.password) : postgresEnv(remoteCreds.password),
          ),
          rsyncCopyFromRemote(runtime, remoteBackupTemp, remoteBackup, "download remote backup"),
          sshCommand(runtime, `rm -f ${shellQuote(remoteBackupTemp)}`),
          dumpSpec(localCreds.engine, localCreds, localTemp, "create upload database dump"),
          rsyncCopyToRemote(runtime, localTemp, remoteTemp, "upload local database dump"),
          sshCommand(
            runtime,
            `${clearSpec(remoteCreds.engine, remoteCreds, "clear remote database").command} ${(
              clearSpec(remoteCreds.engine, remoteCreds, "clear remote database").args ?? []
            )
              .map(shellQuote)
              .join(" ")}`,
            remoteCreds.engine === "mysql" ? mysqlEnv(remoteCreds.password) : postgresEnv(remoteCreds.password),
          ),
          sshCommand(
            runtime,
            importSpec(remoteCreds.engine, remoteCreds, remoteTemp, "import remote database").command,
            remoteCreds.engine === "mysql" ? mysqlEnv(remoteCreds.password) : postgresEnv(remoteCreds.password),
          ),
          sshCommand(runtime, `rm -f ${shellQuote(remoteTemp)}`),
        ];

  return {
    plan: {
      id: taskId,
      title: action === "push" ? "Database push" : "Database pull",
      summary:
        action === "push"
          ? "Replace the remote database with a local dump."
          : "Replace the local database with a remote dump.",
      target: runtime.config.remote.host,
      destructive: true,
      commands,
    },
    artifacts: [session.backupDir],
  };
}

export interface DatabaseDoctorReport {
  ok: boolean;
  engine: DatabaseEngine;
  checks: DoctorCheck[];
  localCredentials?: DatabaseCredentials;
  remoteCredentials?: DatabaseCredentials;
}

export function formatDatabaseDoctorReport(report: DatabaseDoctorReport): string {
  const lines = [`Database engine: ${report.engine}`, ""];
  for (const check of report.checks) {
    const badge =
      check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
    lines.push(`[${badge}] ${check.label}: ${check.message}`);
  }
  return lines.join("\n");
}

export async function doctor(runtime: LoadedRuntime): Promise<DatabaseDoctorReport> {
  const checks: DoctorCheck[] = [];
  const add = (check: DoctorCheck): void => {
    checks.push(check);
  };

  let localCredentials: DatabaseCredentials | undefined;
  try {
    localCredentials = await resolveLocalDatabaseCredentials(
      runtime.options.cwd,
      runtime.config,
      runtime.options,
    );
    add({
      id: "db-local-env",
      label: "Local DB env",
      status: "pass",
      message: `${localCredentials.engine}://${localCredentials.user}@${localCredentials.host}:${localCredentials.port}/${localCredentials.database}`,
    });
  } catch (error) {
    add({
      id: "db-local-env",
      label: "Local DB env",
      status: "fail",
      message: error instanceof Error ? error.message : "Could not resolve local DB settings.",
    });
  }

  let remoteCredentials: DatabaseCredentials | undefined;
  try {
    remoteCredentials = await resolveRemoteDatabaseCredentials(runtime.config, runtime.runner);
    add({
      id: "db-remote-env",
      label: "Remote DB env",
      status: "pass",
      message: `${remoteCredentials.engine}://${remoteCredentials.user}@${remoteCredentials.host}:${remoteCredentials.port}/${remoteCredentials.database}`,
    });
  } catch (error) {
    add({
      id: "db-remote-env",
      label: "Remote DB env",
      status: "fail",
      message: error instanceof Error ? error.message : "Could not resolve remote DB settings.",
    });
  }

  const engine = localCredentials?.engine ?? remoteCredentials?.engine ?? runtime.config.database.engine;
  const localTools = toolsFor(engine, "local", "pull");
  const remoteTools = toolsFor(engine, "remote", "push");

  for (const tool of localTools) {
    const exists = await commandExists(runtime.runner, tool);
    add({
      id: `db-local-tool-${tool}`,
      label: `Local tool: ${tool}`,
      status: exists ? "pass" : "fail",
      message: exists ? `${tool} is available locally.` : `${tool} is missing locally.`,
    });
  }

  for (const tool of remoteTools) {
    const exists = await remoteCommandExists(runtime, tool);
    add({
      id: `db-remote-tool-${tool}`,
      label: `Remote tool: ${tool}`,
      status: exists ? "pass" : "fail",
      message: exists
        ? `${tool} is available on ${runtime.config.remote.host}.`
        : `${tool} is missing on ${runtime.config.remote.host} for ${runtime.config.remote.user}.`,
    });
  }

  return {
    ok: checks.every((check) => check.status === "pass"),
    engine,
    checks,
    localCredentials,
    remoteCredentials,
  };
}

export async function plan(runtime: LoadedRuntime, action: DatabaseAction): Promise<TaskPlan> {
  return (await buildDatabaseCommands(runtime, action)).plan;
}

export async function confirmMessage(runtime: LoadedRuntime, action: DatabaseAction): Promise<string> {
  return action === "push"
    ? `Replace the remote database on ${runtime.config.remote.host}?`
    : "Replace the local database with the remote database?";
}

export async function run(runtime: LoadedRuntime, action: DatabaseAction): Promise<TaskResult> {
  const built = await buildDatabaseCommands(runtime, action);
  ensureForceForDestructive(runtime, built.plan);
  await executePlan(runtime, built.plan);
  return ok(`${built.plan.title} finished successfully.`, built.artifacts);
}
