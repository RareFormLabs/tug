import { defineCommand } from "citty";
import * as databaseTask from "../../tasks/database";
import { sharedArgs, withRuntime } from "../common";
import { restoreFlow } from "../flows";
import { runPrepared } from "../ui";

function createActionCommand(action: "pull" | "push") {
  return defineCommand({
    meta: {
      name: action,
      description:
        action === "pull"
          ? "Replace the local database with the remote one."
          : "Replace the remote database with the local one.",
    },
    args: sharedArgs,
    async run(context) {
      await withRuntime(context.args, async (runtime) => {
        await runPrepared(runtime, await databaseTask.prepare(runtime, action));
      });
    },
  });
}

export const dbCommand = defineCommand({
  meta: {
    name: "db",
    description: "Sync, restore, and check databases.",
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
    restore: defineCommand({
      meta: {
        name: "restore",
        description: "Restore a .sql.gz backup into the local database (pick one when no file is given).",
      },
      args: {
        file: {
          type: "positional",
          required: false,
          description: "Path to a .sql.gz dump, e.g. .tug/backups/<snapshot>/local-before-pull.sql.gz",
        },
        ...sharedArgs,
      },
      async run(context) {
        await withRuntime(context.args, async (runtime) => {
          await restoreFlow(runtime, typeof context.args.file === "string" ? context.args.file : undefined);
        });
      },
    }),
  },
});
