#!/usr/bin/env bun

import { defineCommand, runMain } from "citty";
import { backupsCommand } from "./commands/backups";
import { composerCommand } from "./commands/composer";
import { dbCommand } from "./commands/db";
import { doctorCommand } from "./commands/doctor";
import { folderCommand } from "./commands/folder";
import { initCommand } from "./commands/init";
import { shellCommand } from "./commands/shell";
import { optionsFromArgs, sharedArgs } from "./common";
import { startTui } from "../tui/app";

const main = defineCommand({
  meta: {
    name: "tug",
    version: "0.1.0",
    description: "Craft CMS deployment and sync workflows in a TUI-first CLI.",
  },
  args: sharedArgs,
  subCommands: {
    init: initCommand,
    doctor: doctorCommand,
    folder: folderCommand,
    db: dbCommand,
    composer: composerCommand,
    shell: shellCommand,
    backups: backupsCommand,
  },
  async run(context) {
    const hasSubcommand = context.rawArgs.some((arg) => !arg.startsWith("-"));
    if (hasSubcommand) {
      return;
    }
    const options = optionsFromArgs(context.args);
    if (!options.interactive) {
      throw new Error("The interactive dashboard requires a TTY. Use a subcommand instead.");
    }
    await startTui(options);
  },
});

runMain(main).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
