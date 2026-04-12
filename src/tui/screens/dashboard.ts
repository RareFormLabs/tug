import type { DoctorReport, TaskDescriptor, TugConfig } from "../../types";

export function renderDashboardDetails(args: {
  config: TugConfig;
  selectedTask: TaskDescriptor;
  doctor: DoctorReport;
  lastSummary: string;
}): string {
  const doctorLines = args.doctor.checks
    .slice(0, 4)
    .map((check) => {
      const badge =
        check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
      return `[${badge}] ${check.label}`;
    })
    .join("\n");

  return [
    `${args.selectedTask.title}`,
    "",
    args.selectedTask.description,
    "",
    `Remote: ${args.config.remote.user}@${args.config.remote.host}:${args.config.remote.app_path}`,
    `Database: ${args.config.database.engine}`,
    "",
    "Preflight:",
    doctorLines,
    "",
    "Last run:",
    args.lastSummary || "Nothing run yet.",
  ].join("\n");
}
