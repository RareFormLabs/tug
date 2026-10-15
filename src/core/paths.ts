import path from "node:path";
import { access, mkdir, readdir, stat } from "node:fs/promises";
import type { TugConfig } from "../types";

export const APP_DIRNAME = ".tug";
export const TEMP_DIRNAME = "tmp";
export const DEFAULT_CONFIG_FILE = "tug.toml";

export interface RuntimePaths {
  rootDir: string;
  tempDir: string;
  backupRoot: string;
}

export function resolveConfigPath(cwd: string, provided?: string): string {
  return path.resolve(cwd, provided ?? DEFAULT_CONFIG_FILE);
}

/** Walk up from `cwd` looking for tug.toml. */
export async function findConfigPath(cwd: string): Promise<string | null> {
  let dir = path.resolve(cwd);
  while (true) {
    const candidate = path.join(dir, DEFAULT_CONFIG_FILE);
    try {
      await access(candidate);
      return candidate;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) {
        return null;
      }
      dir = parent;
    }
  }
}

export function resolveRuntimePaths(cwd: string, config: TugConfig): RuntimePaths {
  const rootDir = path.resolve(cwd, APP_DIRNAME);
  const tempDir = path.resolve(rootDir, TEMP_DIRNAME);
  const backupRoot = path.resolve(cwd, config.database.backup_dir);
  return { rootDir, tempDir, backupRoot };
}

export async function ensureRuntimePaths(paths: RuntimePaths): Promise<void> {
  await mkdir(paths.rootDir, { recursive: true });
  await mkdir(paths.tempDir, { recursive: true });
  await mkdir(paths.backupRoot, { recursive: true });
}

export function timestampToken(now = new Date()): string {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

export interface BackupSession {
  token: string;
  backupDir: string;
  tempDir: string;
}

/** Compute where a task's backups will go without touching the filesystem. */
export function planBackupSession(cwd: string, config: TugConfig, token = timestampToken()): BackupSession {
  const paths = resolveRuntimePaths(cwd, config);
  return {
    token,
    backupDir: path.resolve(paths.backupRoot, token),
    tempDir: path.resolve(paths.tempDir, token),
  };
}

export async function ensureBackupSession(session: BackupSession): Promise<void> {
  await mkdir(session.backupDir, { recursive: true });
  await mkdir(session.tempDir, { recursive: true });
}

export async function createBackupSession(cwd: string, config: TugConfig, token = timestampToken()): Promise<BackupSession> {
  const session = planBackupSession(cwd, config, token);
  await ensureBackupSession(session);
  return session;
}

export interface BackupFile {
  name: string;
  path: string;
  size: number;
}

export interface BackupSnapshot {
  token: string;
  path: string;
  createdAt: Date;
  files: BackupFile[];
}

/** Parse a `YYYYMMDD-HHMMSS` session token back into a date. */
export function tokenToDate(token: string): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(token);
  if (!match) {
    return null;
  }
  const [, year, month, day, hours, minutes, seconds] = match.map(Number);
  return new Date(year!, month! - 1, day, hours, minutes, seconds);
}

/** Backup snapshots, newest first. Empty snapshot folders are skipped. */
export async function listBackups(cwd: string, config: TugConfig): Promise<BackupSnapshot[]> {
  const { backupRoot } = resolveRuntimePaths(cwd, config);
  let entries;
  try {
    entries = await readdir(backupRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const snapshots: BackupSnapshot[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const snapshotPath = path.resolve(backupRoot, entry.name);
    const files: BackupFile[] = [];
    for (const file of await readdir(snapshotPath, { withFileTypes: true })) {
      if (!file.isFile()) {
        continue;
      }
      const filePath = path.resolve(snapshotPath, file.name);
      files.push({ name: file.name, path: filePath, size: (await stat(filePath)).size });
    }
    if (files.length === 0) {
      continue;
    }
    const createdAt = tokenToDate(entry.name) ?? (await stat(snapshotPath)).mtime;
    snapshots.push({ token: entry.name, path: snapshotPath, createdAt, files });
  }
  return snapshots.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
}
