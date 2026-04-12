import { defineCommand } from "citty";
import * as backupsTask from "../../tasks/backups";
import { printTaskResult, sharedArgs, withRuntime } from "../common";

function createActionCommand(action: "list" | "open") {
  return defineCommand({
    meta: {
      name: action,
      description: action === "list" ? "List backups." : "Open backups in Finder.",
    },
    args: sharedArgs,
    async run(context) {
      await withRuntime(context.args, async (runtime) => {
        const result = await backupsTask.run(runtime, action);
        printTaskResult(result);
      });
    },
  });
}

export const backupsCommand = defineCommand({
  meta: {
    name: "backups",
    description: "Inspect tug backup snapshots.",
  },
  subCommands: {
    list: createActionCommand("list"),
    open: createActionCommand("open"),
  },
});
