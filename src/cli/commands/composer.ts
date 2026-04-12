import { defineCommand } from "citty";
import * as composerTask from "../../tasks/composer";
import { printTaskResult, sharedArgs, withRuntime } from "../common";

function createActionCommand(action: "pull" | "push") {
  return defineCommand({
    meta: {
      name: action,
      description: `${action === "pull" ? "Pull" : "Push"} composer files.`,
    },
    args: sharedArgs,
    async run(context) {
      await withRuntime(context.args, async (runtime) => {
        const result = await composerTask.run(runtime, action);
        printTaskResult(result);
      });
    },
  });
}

export const composerCommand = defineCommand({
  meta: {
    name: "composer",
    description: "Run composer sync tasks.",
  },
  subCommands: {
    pull: createActionCommand("pull"),
    push: createActionCommand("push"),
  },
});
