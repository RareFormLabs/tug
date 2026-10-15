import path from "node:path";
import type {
  CommandSpec,
  DatabaseAction,
  DatabaseCredentials,
  DatabaseEngine,
  DoctorCheck,
  LoadedRuntime,
  PreparedTask,
  TaskPlan,
} from "../types";
import { resolveLocalDatabaseCredentials, resolveRemoteDatabaseCredentials } from "../core/env";
import { ensureBackupSession, planBackupSession } from "../core/paths";
import { commandExists } from "../core/process";
import { shellQuote } from "../core/shell";
import { ensureTaskEnabled, executePlan, ok } from "./shared";

const dropMysqlTablesSql =
  "SET FOREIGN_KEY_CHECKS = 0;SET GROUP_CONCAT_MAX_LEN=32768;SET @tables = NULL;SELECT GROUP_CONCAT(CONCAT('`', table_name, '`')) INTO @tables FROM information_schema.tables WHERE table_schema = DATABASE();SET @tables = IFNULL(@tables, '');SET @stmt = IF(@tables = '', 'SELECT 1', CONCAT('DROP TABLE IF EXISTS ', @tables));PREPARE stmt FROM @stmt;EXECUTE stmt;DEALLOCATE PREPARE stmt;SET FOREIGN_KEY_CHECKS = 1;";

function mysqlEnv(password: string): Record<string, string> {
  return { MYSQL_PWD: password };
}

function postgresEnv(password: string): Record<string, string> {
  return { PGPASSWORD: password };
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

function specToShellCommand(spec: CommandSpec): string {
  if (spec.shell) {
    return spec.command;
  }
  return [spec.command, ...((spec.args ?? []).map(shellQuote))].join(" ");
}

/**
 * Make a pipeline fail when any part of it fails (say mysqldump dies halfway while
 * gzip exits cleanly), so a truncated dump is never imported. Shells without
 * pipefail skip it.
 */
const PIPEFAIL = "(set -o pipefail) 2>/dev/null && set -o pipefail;";

function credentialsEnv(credentials: DatabaseCredentials): Record<string, string> {
  return credentials.engine === "mysql" ? mysqlEnv(credentials.password) : postgresEnv(credentials.password);
}

/** A shell pipeline that writes a gzipped dump to stdout. */
function dumpCommand(credentials: DatabaseCredentials): string {
  const { host, port, user, database } = credentials;
  const dump =
    credentials.engine === "mysql"
      ? `mysqldump --host=${shellQuote(host)} --port=${port} --user=${shellQuote(user)} --lock-tables=false --no-tablespaces --column-statistics=0 ${shellQuote(database)}`
      : `pg_dump --clean --if-exists --no-owner --no-privileges --host=${shellQuote(host)} --port=${port} --username=${shellQuote(user)} ${shellQuote(database)}`;
  return `${PIPEFAIL} ${dump} | gzip`;
}

/** A shell pipeline that imports a gzipped dump from `inputPath`, or from stdin. */
function importCommand(credentials: DatabaseCredentials, inputPath?: string): string {
  const { host, port, user, database } = credentials;
  const source = inputPath ? `gzip -dc ${shellQuote(inputPath)}` : "gzip -dc";
  const client =
    credentials.engine === "mysql"
      ? `mysql --host=${shellQuote(host)} --port=${port} --user=${shellQuote(user)} ${shellQuote(database)}`
      : `psql --host=${shellQuote(host)} --port=${port} --username=${shellQuote(user)} --dbname=${shellQuote(database)} --set ON_ERROR_STOP=on`;
  return `${PIPEFAIL} ${source} | ${client}`;
}

/** Dump a local database to a gzipped file, showing how much has been written. */
function localDumpSpec(credentials: DatabaseCredentials, outputPath: string, label: string): CommandSpec {
  return {
    command: dumpCommand(credentials),
    shell: true,
    env: credentialsEnv(credentials),
    stdoutFile: outputPath,
    stderr: "pipe",
    display: label,
    progress: { kind: "stdoutBytes" },
  };
}

/** Import a gzipped dump into a local database, with progress through the file. */
function localImportSpec(credentials: DatabaseCredentials, inputPath: string, label: string): CommandSpec {
  return {
    command: importCommand(credentials),
    shell: true,
    env: credentialsEnv(credentials),
    stdinFile: inputPath,
    stdout: "pipe",
    stderr: "pipe",
    display: label,
    progress: { kind: "stdinBytes" },
  };
}

function clearSpec(engine: DatabaseEngine, credentials: DatabaseCredentials, label: string): CommandSpec {
  return engine === "mysql"
    ? mysqlClearSpec(credentials, label)
    : postgresClearSpec(credentials, label);
}

function sshCommand(
  runtime: LoadedRuntime,
  label: string,
  remoteScript: string,
  env?: Record<string, string>,
): CommandSpec {
  const prefix = env
    ? `${Object.entries(env)
        .map(([key, value]) => `export ${key}=${shellQuote(value ?? "")};`)
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
    display: label,
  };
}

function sshTarget(runtime: LoadedRuntime): string[] {
  return ["-p", String(runtime.config.remote.port), `${runtime.config.remote.user}@${runtime.config.remote.host}`];
}

async function remoteFileSize(runtime: LoadedRuntime, remotePath: string): Promise<number | undefined> {
  const result = await runtime.runner.run({
    command: "ssh",
    args: [...sshTarget(runtime), `wc -c < ${shellQuote(remotePath)}`],
    stdout: "pipe",
    stderr: "pipe",
    allowFailure: true,
  });
  const size = Number.parseInt(result.stdout.trim(), 10);
  return result.exitCode === 0 && Number.isFinite(size) ? size : undefined;
}

/** Stream a remote file over SSH into a local file, with a progress bar. */
function downloadSpec(runtime: LoadedRuntime, remotePath: string, localPath: string, label: string): CommandSpec {
  return {
    command: "ssh",
    args: [...sshTarget(runtime), `cat ${shellQuote(remotePath)}`],
    stdoutFile: localPath,
    stderr: "pipe",
    display: label,
    progress: { kind: "stdoutBytes", total: () => remoteFileSize(runtime, remotePath) },
  };
}

/** Stream a local file over SSH into a remote file, with a progress bar. */
function uploadSpec(runtime: LoadedRuntime, localPath: string, remotePath: string, label: string): CommandSpec {
  return {
    command: "ssh",
    args: [...sshTarget(runtime), `cat > ${shellQuote(remotePath)}`],
    stdinFile: localPath,
    stdout: "pipe",
    stderr: "pipe",
    display: label,
    progress: { kind: "stdinBytes" },
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
      return action === "pull" ? ["mysql"] : ["mysqldump"];
    }
    return action === "pull" ? ["mysqldump"] : ["mysqldump", "mysql"];
  }

  if (side === "local") {
    return action === "pull" ? ["psql"] : ["pg_dump"];
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

export interface DatabaseCommands {
  plan: TaskPlan;
  artifacts: string[];
  session: ReturnType<typeof planBackupSession>;
  local: DatabaseCredentials;
  remote: DatabaseCredentials;
}

export async function buildDatabaseCommands(
  runtime: LoadedRuntime,
  action: DatabaseAction,
): Promise<DatabaseCommands> {
  const taskId = action === "push" ? "databasePush" : "databasePull";
  ensureTaskEnabled(runtime.config, taskId);

  const localCreds = await resolveLocalDatabaseCredentials(
    runtime.options.cwd,
    runtime.config,
    runtime.options,
  );
  const remoteCreds = await resolveRemoteDatabaseCredentials(runtime.config, runtime.runner);
  if (localCreds.engine !== remoteCreds.engine) {
    throw new Error(
      `Local database is ${localCreds.engine} but remote database is ${remoteCreds.engine}. Tug can only sync matching engines.`,
    );
  }
  await assertDatabasePrereqs(runtime, localCreds.engine, remoteCreds.engine, action);
  const session = planBackupSession(runtime.options.cwd, runtime.config);
  const localBackup = path.resolve(session.backupDir, `local-${action === "push" ? "before-push" : "before-pull"}.sql.gz`);
  const remoteBackup = path.resolve(session.backupDir, `remote-${action === "push" ? "before-push" : "source"}.sql.gz`);
  const localTemp = path.resolve(session.tempDir, `${action}.sql.gz`);
  const remoteTemp = remoteTempPath(runtime, `${session.token}-${action}.sql.gz`);
  const remoteBackupTemp = remoteTempPath(runtime, `${session.token}-backup.sql.gz`);
  const remoteEnv = credentialsEnv(remoteCreds);

  const ensureRemoteTmp = sshCommand(
    runtime,
    "Prepare remote temp folder",
    `mkdir -p ${shellQuote(path.posix.dirname(remoteTemp))}`,
  );

  const commands: CommandSpec[] =
    action === "pull"
      ? [
          ensureRemoteTmp,
          sshCommand(
            runtime,
            `Dump remote database ${remoteCreds.database}`,
            `${dumpCommand(remoteCreds)} > ${shellQuote(remoteTemp)}`,
            remoteEnv,
          ),
          downloadSpec(runtime, remoteTemp, localTemp, "Download remote dump"),
          sshCommand(runtime, "Remove remote dump", `rm -f ${shellQuote(remoteTemp)}`),
          localDumpSpec(localCreds, localBackup, `Back up local database ${localCreds.database}`),
          clearSpec(localCreds.engine, localCreds, "Clear local database"),
          localImportSpec(localCreds, localTemp, "Import into local database"),
        ]
      : [
          ensureRemoteTmp,
          localDumpSpec(localCreds, localBackup, `Back up local database ${localCreds.database}`),
          sshCommand(
            runtime,
            `Back up remote database ${remoteCreds.database}`,
            `${dumpCommand(remoteCreds)} > ${shellQuote(remoteBackupTemp)}`,
            remoteEnv,
          ),
          downloadSpec(runtime, remoteBackupTemp, remoteBackup, "Download remote backup"),
          sshCommand(runtime, "Remove remote backup temp file", `rm -f ${shellQuote(remoteBackupTemp)}`),
          localDumpSpec(localCreds, localTemp, "Dump local database for upload"),
          uploadSpec(runtime, localTemp, remoteTemp, "Upload local dump"),
          sshCommand(
            runtime,
            "Clear remote database",
            specToShellCommand(clearSpec(remoteCreds.engine, remoteCreds, "clear remote database")),
            remoteEnv,
          ),
          sshCommand(
            runtime,
            "Import into remote database",
            importCommand(remoteCreds, remoteTemp),
            remoteEnv,
          ),
          sshCommand(runtime, "Remove remote upload", `rm -f ${shellQuote(remoteTemp)}`),
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
    session,
    local: localCreds,
    remote: remoteCreds,
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

export function describeCredentials(credentials: DatabaseCredentials): string {
  return `${credentials.engine}://${credentials.user}@${credentials.host}:${credentials.port}/${credentials.database}`;
}

/** Check that local and remote database settings can be read. */
export async function checkDatabaseEnv(runtime: LoadedRuntime): Promise<{
  checks: DoctorCheck[];
  localCredentials?: DatabaseCredentials;
  remoteCredentials?: DatabaseCredentials;
}> {
  const checks: DoctorCheck[] = [];

  let localCredentials: DatabaseCredentials | undefined;
  try {
    localCredentials = await resolveLocalDatabaseCredentials(
      runtime.options.cwd,
      runtime.config,
      runtime.options,
    );
    checks.push({
      id: "db-local-env",
      label: "Local DB env",
      status: "pass",
      message: describeCredentials(localCredentials),
    });
  } catch (error) {
    checks.push({
      id: "db-local-env",
      label: "Local DB env",
      status: "fail",
      message: error instanceof Error ? error.message : "Could not resolve local DB settings.",
    });
  }

  let remoteCredentials: DatabaseCredentials | undefined;
  try {
    remoteCredentials = await resolveRemoteDatabaseCredentials(runtime.config, runtime.runner);
    checks.push({
      id: "db-remote-env",
      label: "Remote DB env",
      status: "pass",
      message: describeCredentials(remoteCredentials),
    });
  } catch (error) {
    checks.push({
      id: "db-remote-env",
      label: "Remote DB env",
      status: "fail",
      message: error instanceof Error ? error.message : "Could not resolve remote DB settings.",
    });
  }

  return { checks, localCredentials, remoteCredentials };
}

export async function doctor(runtime: LoadedRuntime): Promise<DatabaseDoctorReport> {
  const env = await checkDatabaseEnv(runtime);
  const checks: DoctorCheck[] = [...env.checks];
  const add = (check: DoctorCheck): void => {
    checks.push(check);
  };
  const { localCredentials, remoteCredentials } = env;

  const engine = localCredentials?.engine ?? remoteCredentials?.engine ?? runtime.config.database.engine;
  const localTools = engine === "mysql" ? ["mysqldump", "mysql"] : ["pg_dump", "psql"];
  const remoteTools = engine === "mysql" ? ["mysqldump", "mysql"] : ["pg_dump", "psql"];

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

function relativeToProject(runtime: LoadedRuntime, target: string): string {
  return path.relative(runtime.options.cwd, target) || ".";
}

/**
 * Resolve credentials and check tools on both sides before anything is asked or
 * changed, so a missing tool fails immediately instead of after confirming.
 */
export async function prepare(runtime: LoadedRuntime, action: DatabaseAction): Promise<PreparedTask> {
  const built = await runtime.reporter.step("Reading database settings", () =>
    buildDatabaseCommands(runtime, action),
  );
  const host = runtime.config.remote.host;
  const remote = `${built.remote.database} on ${host}`;
  const local = `${built.local.database} on ${built.local.host}:${built.local.port}`;
  const backupDir = relativeToProject(runtime, built.session.backupDir);

  return {
    id: built.plan.id,
    title: built.plan.title,
    details:
      action === "pull"
        ? [`From  ${remote}`, `To    ${local} (replaced)`, "", `Your local database is backed up to ${backupDir}/ first.`]
        : [
            `From  ${local}`,
            `To    ${remote} (replaced)`,
            "",
            `Both databases are backed up to ${backupDir}/ first.`,
          ],
    confirm:
      action === "pull"
        ? { message: `Replace local database ${built.local.database}?`, initialValue: true }
        : { message: `Replace REMOTE database ${built.remote.database} on ${host}?`, initialValue: false },
    execute: async () => {
      await ensureBackupSession(built.session);
      await executePlan(runtime, built.plan);
      return ok(`${built.plan.title} finished.`, built.artifacts);
    },
  };
}

/** Replace the local database with a `.sql.gz` dump, backing up the current one first. */
export async function prepareRestore(runtime: LoadedRuntime, dumpPath: string): Promise<PreparedTask> {
  const source = path.resolve(runtime.options.cwd, dumpPath);
  if (!source.endsWith(".sql.gz")) {
    throw new Error(`Expected a .sql.gz database dump, got ${dumpPath}.`);
  }
  if (!(await Bun.file(source).exists())) {
    throw new Error(`Backup file not found: ${dumpPath}`);
  }
  const local = await resolveLocalDatabaseCredentials(runtime.options.cwd, runtime.config, runtime.options);
  for (const tool of local.engine === "mysql" ? ["mysql", "mysqldump"] : ["psql", "pg_dump"]) {
    if (!(await commandExists(runtime.runner, tool))) {
      throw new Error(`Local database prerequisite missing: ${tool} is not installed or not on PATH.`);
    }
  }
  const session = planBackupSession(runtime.options.cwd, runtime.config);
  const safetyBackup = path.resolve(session.backupDir, "local-before-restore.sql.gz");
  const taskPlan: TaskPlan = {
    id: "databaseRestore",
    title: "Database restore",
    summary: "Replace the local database with a backup.",
    target: "local",
    destructive: true,
    commands: [
      localDumpSpec(local, safetyBackup, `Back up local database ${local.database}`),
      clearSpec(local.engine, local, "Clear local database"),
      localImportSpec(local, source, `Import ${path.basename(source)}`),
    ],
  };

  return {
    id: taskPlan.id,
    title: taskPlan.title,
    details: [
      `From  ${relativeToProject(runtime, source)}`,
      `To    ${local.database} on ${local.host}:${local.port} (replaced)`,
      "",
      `Your current local database is backed up to ${relativeToProject(runtime, session.backupDir)}/ first.`,
    ],
    confirm: { message: `Replace local database ${local.database}?`, initialValue: true },
    execute: async () => {
      await ensureBackupSession(session);
      await executePlan(runtime, taskPlan);
      return ok("Database restore finished.", [session.backupDir]);
    },
  };
}
