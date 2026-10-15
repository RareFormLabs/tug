import { defineCommand } from "citty";
import { configExists, writeInitialConfig } from "../../core/config";
import { optionsFromArgs, sharedArgs } from "../common";
import { initWizard } from "../flows";

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Set up tug.toml for this project (asks a few questions in a terminal).",
  },
  args: sharedArgs,
  async run(context) {
    const options = optionsFromArgs(context.args);
    if (!options.interactive) {
      const filePath = await writeInitialConfig(options.cwd, options.configPath, options.force);
      console.log(`Created ${filePath} from the example config. Edit it before running tasks.`);
      return;
    }
    if (!options.force && (await configExists(options.cwd, options.configPath))) {
      throw new Error("tug.toml already exists. Re-run with --yes to replace it.");
    }
    await initWizard(options.cwd, options.configPath);
  },
});
