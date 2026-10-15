import { defineCommand } from "citty";
import * as shellTask from "../../tasks/shell";
import { printTaskResult, sharedArgs, withRuntime } from "../common";

export const shellCommand = defineCommand({
  meta: {
    name: "shell",
    description: "Open a shell in the remote project folder.",
  },
  args: sharedArgs,
  async run(context) {
    await withRuntime(context.args, async (runtime) => {
      printTaskResult(await shellTask.run(runtime));
    });
  },
});
