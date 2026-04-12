import { defineCommand } from "citty";
import * as databaseTask from "../../tasks/database";
import { printTaskResult, sharedArgs, withRuntime } from "../common";

function createActionCommand(action: "pull" | "push") {
  return defineCommand({
    meta: {
      name: action,
      description: `${action === "pull" ? "Pull" : "Push"} the configured database.`,
    },
    args: sharedArgs,
    async run(context) {
      await withRuntime(context.args, async (runtime) => {
        const result = await databaseTask.run(runtime, action);
        printTaskResult(result);
      });
    },
  });
}

export const dbCommand = defineCommand({
  meta: {
    name: "db",
    description: "Run database sync tasks.",
  },
  subCommands: {
    doctor: defineCommand({
      meta: {
        name: "doctor",
        description: "Check local and remote database prerequisites.",
      },
      args: sharedArgs,
      async run(context) {
        await withRuntime(context.args, async (runtime) => {
          const report = await databaseTask.doctor(runtime);
          if (runtime.options.json) {
            console.log(JSON.stringify(report, null, 2));
          } else {
            console.log(databaseTask.formatDatabaseDoctorReport(report));
          }
          if (!report.ok) {
            process.exitCode = 1;
          }
        });
      },
    }),
    pull: createActionCommand("pull"),
    push: createActionCommand("push"),
  },
});
