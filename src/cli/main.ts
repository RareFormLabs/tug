#!/usr/bin/env bun

import { styleText } from "node:util";
import { defineCommand, runCommand, runMain, showUsage } from "citty";
import { backupsCommand } from "./commands/backups";
import { COMPOSER_TASKS_AVAILABLE } from "../tasks/composer";
import { composerCommand } from "./commands/composer";
import { dbCommand } from "./commands/db";
import { doctorCommand } from "./commands/doctor";
import { folderCommand } from "./commands/folder";
import { initCommand } from "./commands/init";
import { shellCommand } from "./commands/shell";
import { optionsFromArgs, sharedArgs } from "./common";
import { startInteractive } from "./menu";
import { playSound } from "../core/sound";
import { errorMessage, ui } from "./ui";

const subCommands = {
  init: initCommand,
  doctor: doctorCommand,
  folder: folderCommand,
  db: dbCommand,
  ...(COMPOSER_TASKS_AVAILABLE ? { composer: composerCommand } : {}),
  shell: shellCommand,
  backups: backupsCommand,
};

const main = defineCommand({
  meta: {
    name: "tug",
    version: "0.1.0",
    description: "Sync folders and databases between a Craft CMS project and its server.",
  },
  args: sharedArgs,
  subCommands,
  async run(context) {
    const knownSubcommands = new Set(Object.keys(subCommands));
    const firstPositional = Array.isArray(context.args._)
      ? context.args._.find((value: unknown) => typeof value === "string")
      : undefined;
    const hasSubcommand =
      typeof firstPositional === "string" && knownSubcommands.has(firstPositional);
    if (hasSubcommand) {
      return;
    }
    const options = optionsFromArgs(context.args);
    if (!options.interactive) {
      throw new Error("Interactive mode needs a terminal. Use a subcommand instead (see `tug --help`).");
    }
    await startInteractive(options);
  },
});

async function run(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  // citty's runMain prints raw errors with stack traces, so it only handles help and version.
  if (rawArgs.includes("--help") || rawArgs.includes("-h") || (rawArgs.length === 1 && rawArgs[0] === "--version")) {
    await runMain(main);
    return;
  }
  try {
    await runCommand(main, { rawArgs });
  } catch (error) {
    if (error instanceof Error && "code" in error && String(error.code).startsWith("E_")) {
      // Argument errors from citty: show usage like runMain would.
      await showUsage(main);
    }
    if (process.stdout.isTTY) {
      ui.error(errorMessage(error));
      playSound("error");
    } else {
      console.error(styleText("red", `✗ ${errorMessage(error)}`));
    }
    process.exit(1);
  }
}

await run();
