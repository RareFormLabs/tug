export type DatabaseEngine = "mysql" | "postgres";
export type FolderAction = "pull" | "push";
export type DatabaseAction = "pull" | "push";
export type ComposerAction = "pull" | "push";
export type BackupAction = "list" | "open";

export interface TugProjectConfig {
  name?: string;
  disabled_tasks: string[];
}

export interface TugRemoteConfig {
  host: string;
  user: string;
  port: number;
  app_path: string;
  env_path: string;
}

export interface TugFilesConfig {
  push: string[];
  pull: string[];
  exclude: string[];
}

export interface TugDatabaseConfig {
  engine: DatabaseEngine;
  local_env_file: string;
  remote_env_path: string;
  backup_dir: string;
}

export interface TugComposerConfig {
  enabled: boolean;
}

export interface TugConfig {
  project: TugProjectConfig;
  remote: TugRemoteConfig;
  files: TugFilesConfig;
  database: TugDatabaseConfig;
  composer: TugComposerConfig;
}

export interface RuntimeOptions {
  cwd: string;
  configPath?: string;
  envFile?: string;
  force: boolean;
  dryRun: boolean;
  verbose: boolean;
  json: boolean;
  interactive: boolean;
}

export interface CommandSpec {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  shell?: boolean;
  stdin?: "inherit" | "pipe" | string;
  stdout?: "inherit" | "pipe";
  stderr?: "inherit" | "pipe";
  display?: string;
  allowFailure?: boolean;
}

export interface CommandHooks {
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProcessRunner {
  run(spec: CommandSpec, hooks?: CommandHooks): Promise<CommandResult>;
}

export interface Logger {
  add(line: string): void;
  clear(): void;
  snapshot(): string[];
  subscribe(listener: (lines: string[]) => void): () => void;
}

export interface TaskPlan {
  id: string;
  title: string;
  summary: string;
  target: string;
  destructive: boolean;
  commands: CommandSpec[];
}

export interface TaskResult {
  ok: boolean;
  summary: string;
  artifacts?: string[];
}

export interface DoctorCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

export interface DatabaseCredentials {
  engine: DatabaseEngine;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  url?: string;
}

export interface LoadedRuntime {
  options: RuntimeOptions;
  config: TugConfig;
  runner: ProcessRunner;
  logger: Logger;
}

export interface TaskDescriptor {
  id: string;
  title: string;
  description: string;
  disabledBy?: "composer";
  action?:
    | FolderAction
    | DatabaseAction
    | ComposerAction
    | BackupAction
    | "shell";
}
