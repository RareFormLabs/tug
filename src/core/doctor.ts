import { configExists, readConfig } from "./config";
import { commandExists } from "./process";
import type {
  DoctorCheck,
  DoctorReport,
  ProcessRunner,
  RuntimeOptions,
  TugConfig,
} from "../types";

function resultFromChecks(checks: DoctorCheck[]): DoctorReport {
  return {
    ok: checks.every((check) => check.status !== "fail"),
    checks,
  };
}

function databaseTools(engine: "mysql" | "postgres"): string[] {
  return engine === "mysql" ? ["mysql", "mysqldump"] : ["psql", "pg_dump"];
}

function requiredTools(config: TugConfig | null): string[] {
  const tools = ["ssh", "rsync", "gzip"];
  if (config) {
    tools.push(...databaseTools(config.database.engine));
  }
  return tools;
}

// SSH can connect successfully yet stall on the remote command; cap the probe and
// treat timeout the same as "tool not available" so doctor stays responsive.
async function remoteToolExists(
  runner: ProcessRunner,
  config: TugConfig,
  tool: string,
): Promise<boolean> {
  try {
    const result = await Promise.race([
      runner.run({
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
          String(config.remote.port),
          `${config.remote.user}@${config.remote.host}`,
          `command -v ${tool} >/dev/null 2>&1`,
        ],
        stdout: "pipe",
        stderr: "pipe",
        allowFailure: true,
      }),
      new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
        setTimeout(() => {
          resolve({ exitCode: 124, stdout: "", stderr: "Timed out checking remote tool." });
        }, 3000);
      }),
    ]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function inspectProject(
  options: RuntimeOptions,
  runner: ProcessRunner,
  onCheck?: (check: DoctorCheck) => void,
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const addCheck = (check: DoctorCheck): void => {
    checks.push(check);
    onCheck?.(check);
  };
  const hasConfig = await configExists(options.cwd, options.configPath);
  if (!hasConfig) {
    addCheck({
      id: "config",
      label: "Config file",
      status: "fail",
      message: "Missing tug.toml. Run `tug init` first.",
    });
    return resultFromChecks(checks);
  }

  let config: TugConfig;
  try {
    config = await readConfig(options.cwd, options.configPath);
    addCheck({
      id: "config",
      label: "Config file",
      status: "pass",
      message: "Loaded tug.toml successfully.",
    });
  } catch (error) {
    addCheck({
      id: "config-parse",
      label: "Config validation",
      status: "fail",
      message: error instanceof Error ? error.message : "Failed to parse tug.toml.",
    });
    return resultFromChecks(checks);
  }

  for (const tool of requiredTools(config)) {
    const exists = await commandExists(runner, tool);
    addCheck({
      id: `tool-${tool}`,
      label: `Tool: ${tool}`,
      status: exists ? "pass" : "fail",
      message: exists ? `${tool} is available.` : `${tool} is required but missing.`,
    });
  }

  try {
    await runner.run({
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
        String(config.remote.port),
        `${config.remote.user}@${config.remote.host}`,
        "true",
      ],
      stdout: "pipe",
      stderr: "pipe",
      display: `ssh ${config.remote.user}@${config.remote.host} true`,
    });
    addCheck({
      id: "ssh-reachability",
      label: "SSH reachability",
      status: "pass",
      message: `SSH connectivity to ${config.remote.host} succeeded.`,
    });

    const remoteTools = databaseTools(config.database.engine);
    for (const tool of remoteTools) {
      const exists = await remoteToolExists(runner, config, tool);
      addCheck({
        id: `remote-tool-${tool}`,
        label: `Remote tool: ${tool}`,
        status: exists ? "pass" : "warn",
        message: exists
          ? `${tool} is available on ${config.remote.host}.`
          : `${tool} is missing on ${config.remote.host} for SSH user ${config.remote.user}.`,
      });
    }
  } catch (error) {
    addCheck({
      id: "ssh-reachability",
      label: "SSH reachability",
      status: "fail",
      message:
        error instanceof Error
          ? error.message
          : `Unable to verify SSH connectivity to ${config.remote.host}.`,
    });
  }

  return resultFromChecks(checks);
}

export function formatDoctorReport(report: DoctorReport): string {
  return report.checks
    .map((check) => {
      const badge =
        check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
      return `[${badge}] ${check.label}: ${check.message}`;
    })
    .join("\n");
}
