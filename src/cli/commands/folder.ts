import { defineCommand } from "citty";
import * as folderTask from "../../tasks/folder";
import { sharedArgs, withRuntime } from "../common";
import { runPrepared } from "../ui";

function createActionCommand(action: "pull" | "push") {
  return defineCommand({
    meta: {
      name: action,
      description:
        action === "pull"
          ? "Pull configured folders from the remote."
          : "Push configured folders to the remote (previews changes first).",
    },
    args: sharedArgs,
    async run(context) {
      await withRuntime(context.args, async (runtime) => {
        // Preview only when someone is there to read it and answer the prompt.
        const preview = action === "push" && runtime.options.interactive && !runtime.options.force;
        await runPrepared(runtime, await folderTask.prepare(runtime, action, { preview }));
      });
    },
  });
}

export const folderCommand = defineCommand({
  meta: {
    name: "folder",
    description: "Sync configured folders.",
  },
  subCommands: {
    pull: createActionCommand("pull"),
    push: createActionCommand("push"),
  },
});
