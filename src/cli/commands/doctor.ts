import { defineCommand } from "citty";
import { inspectProject } from "../../core/doctor";
import { BunProcessRunner } from "../../core/process";
import { optionsFromArgs, sharedArgs } from "../common";

export const doctorCommand = defineCommand({
  meta: {
    name: "doctor",
    description: "Validate tug config, tools, and SSH reachability.",
  },
  args: sharedArgs,
  async run(context) {
    const options = optionsFromArgs(context.args);
    const runner = new BunProcessRunner();
    const report = await inspectProject(
      options,
      runner,
      options.json
        ? undefined
        : (check) => {
            const badge =
              check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
            console.log(`[${badge}] ${check.label}: ${check.message}`);
          },
    );
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) {
        process.exitCode = 1;
      }
      return;
    }
    if (!report.ok) {
      process.exitCode = 1;
    }
  },
});
