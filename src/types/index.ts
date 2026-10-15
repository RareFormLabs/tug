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
  /** Rewrite an output line for display, or drop it by returning null. */
  formatLine?: (line: string) => string | null;
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

export interface Reporter {
  /** Run one unit of work, showing progress and any output lines it emits. */
  step<T>(label: string, work: (onLine: (line: string) => void) => Promise<T>): Promise<T>;
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

export interface TaskConfirmation {
  message: string;
  /** Default answer. Tasks that change the remote default to "no". */
  initialValue: boolean;
}

/**
 * A task whose inputs have been resolved and validated, ready to show the user
 * what will happen before anything is changed.
 */
export interface PreparedTask {
  title: string;
  /** Lines describing what will change, shown before confirming. */
  details: string[];
  /** Set when the task would change nothing; the runner reports it and skips execution. */
  nothingToDo?: string;
  confirm?: TaskConfirmation;
  execute(): Promise<TaskResult>;
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
  reporter: Reporter;
}
