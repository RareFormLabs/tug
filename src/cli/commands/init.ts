import { defineCommand } from "citty";
import { writeInitialConfig } from "../../core/config";
import { optionsFromArgs, sharedArgs } from "../common";

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Create a starter tug.toml file.",
  },
  args: sharedArgs,
  async run(context) {
    const options = optionsFromArgs(context.args);
    const filePath = await writeInitialConfig(
      options.cwd,
      options.configPath,
      options.force,
    );
    console.log(`Created ${filePath}`);
  },
});
