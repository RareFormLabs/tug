import path from "node:path";
import { mkdir, readdir } from "node:fs/promises";
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

export async function createBackupSession(cwd: string, config: TugConfig, token = timestampToken()): Promise<{
  token: string;
  backupDir: string;
  tempDir: string;
}> {
  const paths = resolveRuntimePaths(cwd, config);
  await ensureRuntimePaths(paths);
  const backupDir = path.resolve(paths.backupRoot, token);
  const tempDir = path.resolve(paths.tempDir, token);
  await mkdir(backupDir, { recursive: true });
  await mkdir(tempDir, { recursive: true });
  return { token, backupDir, tempDir };
}

export async function listBackups(cwd: string, config: TugConfig): Promise<string[]> {
  const paths = resolveRuntimePaths(cwd, config);
  await ensureRuntimePaths(paths);
  const entries = await readdir(paths.backupRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));
}
