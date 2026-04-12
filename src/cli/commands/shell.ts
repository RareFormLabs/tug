import { defineCommand } from "citty";
import * as shellTask from "../../tasks/shell";
import { printTaskResult, sharedArgs, withRuntime } from "../common";

export const shellCommand = defineCommand({
  meta: {
    name: "shell",
    description: "Open a remote shell session.",
  },
  args: sharedArgs,
  async run(context) {
    await withRuntime(context.args, async (runtime) => {
      const result = await shellTask.run(runtime);
      printTaskResult(result);
    });
  },
});
