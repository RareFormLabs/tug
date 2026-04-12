import { defineCommand } from "citty";
import * as folderTask from "../../tasks/folder";
import { printTaskResult, sharedArgs, withRuntime } from "../common";

function createActionCommand(action: "pull" | "push") {
  return defineCommand({
    meta: {
      name: action,
      description: `${action === "pull" ? "Pull" : "Push"} configured folders.`,
    },
    args: sharedArgs,
    async run(context) {
      await withRuntime(context.args, async (runtime) => {
        const result = await folderTask.run(runtime, action);
        printTaskResult(result);
      });
    },
  });
}

export const folderCommand = defineCommand({
  meta: {
    name: "folder",
    description: "Run folder sync tasks.",
  },
  subCommands: {
    pull: createActionCommand("pull"),
    push: createActionCommand("push"),
  },
});
