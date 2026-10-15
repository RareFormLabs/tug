import { defineCommand } from "citty";
import { resolveProjectOptions } from "../../core/runtime";
import { optionsFromArgs, sharedArgs } from "../common";
import { doctorFlow, runDoctor } from "../flows";

export const doctorCommand = defineCommand({
  meta: {
    name: "doctor",
    description: "Check tug config, local tools, SSH access, and database settings.",
  },
  args: sharedArgs,
  async run(context) {
    const options = await resolveProjectOptions(optionsFromArgs(context.args));
    if (options.json) {
      const report = await runDoctor(options);
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.ok ? 0 : 1;
      return;
    }
    process.exitCode = (await doctorFlow(options)) ? 0 : 1;
  },
});
