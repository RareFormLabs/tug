import { defineCommand } from "citty";
import * as composerTask from "../../tasks/composer";
import { sharedArgs, withRuntime } from "../common";
import { runPrepared } from "../ui";

function createActionCommand(action: "pull" | "push") {
  return defineCommand({
    meta: {
      name: action,
      description: `${action === "pull" ? "Pull" : "Push"} composer.json and composer.lock.`,
    },
    args: sharedArgs,
    async run(context) {
      await withRuntime(context.args, async (runtime) => {
        await runPrepared(runtime, await composerTask.prepare(runtime, action));
      });
    },
  });
}

export const composerCommand = defineCommand({
  meta: {
    name: "composer",
    description: "Sync composer files.",
  },
  subCommands: {
    pull: createActionCommand("pull"),
    push: createActionCommand("push"),
  },
});
