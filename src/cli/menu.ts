import { styleText } from "node:util";
import { confirm, intro, isCancel, log, outro, select } from "@clack/prompts";
import { findConfigPath, listBackups } from "../core/paths";
import { createLoadedRuntime } from "../core/runtime";
import * as backupsTask from "../tasks/backups";
import * as composerTask from "../tasks/composer";
import * as databaseTask from "../tasks/database";
import * as folderTask from "../tasks/folder";
import * as shellTask from "../tasks/shell";
import type { LoadedRuntime, RuntimeOptions } from "../types";
import { backupsFlow, doctorFlow, initWizard } from "./flows";
import { PromptCancelled, errorMessage, runPrepared, ui } from "./ui";

interface MenuItem {
  /** Matches the ids accepted by `project.disabled_tasks`. */
  id: string;
  label: string;
  hint: string;
  enabled: boolean;
  run(): Promise<void>;
}

function menuItems(runtime: LoadedRuntime, backupHint: string): MenuItem[] {
  const { config } = runtime;
  const host = config.remote.host;
  const disabled = new Set(config.project.disabled_tasks);
  const prepared = async (prepare: () => Promise<Parameters<typeof runPrepared>[1]>) => {
    await runPrepared(runtime, await prepare());
  };

  const items: MenuItem[] = [
    {
      id: "folderPull",
      label: "Pull folders",
      hint: `${config.files.pull.join(", ") || "none configured"} from ${host}`,
      enabled: config.files.pull.length > 0,
      run: () => prepared(() => folderTask.prepare(runtime, "pull")),
    },
    {
      id: "folderPush",
      label: "Push folders",
      hint: `${config.files.push.join(", ") || "none configured"} to ${host}, previewed first`,
      enabled: config.files.push.length > 0,
      run: () => prepared(() => folderTask.prepare(runtime, "push", { preview: true })),
    },
    {
      id: "databasePull",
      label: "Pull database",
      hint: "replace local with remote, backed up first",
      enabled: true,
      run: () => prepared(() => databaseTask.prepare(runtime, "pull")),
    },
    {
      id: "databasePush",
      label: "Push database",
      hint: `replace ${host} with local, backed up first`,
      enabled: true,
      run: () => prepared(() => databaseTask.prepare(runtime, "push")),
    },
    {
      id: "composerPull",
      label: "Pull composer files",
      hint: `composer.json and composer.lock from ${host}`,
      enabled: config.composer.enabled,
      run: () => prepared(() => composerTask.prepare(runtime, "pull")),
    },
    {
      id: "composerPush",
      label: "Push composer files",
      hint: `composer.json and composer.lock to ${host}`,
      enabled: config.composer.enabled,
      run: () => prepared(() => composerTask.prepare(runtime, "push")),
    },
    {
      id: "terminal",
      label: "Remote shell",
      hint: `ssh into ${config.remote.app_path}`,
      enabled: true,
      run: async () => {
        log.step(`Connecting to ${config.remote.user}@${host}. Type exit to come back.`);
        ui.success((await shellTask.run(runtime)).summary);
      },
    },
    {
      id: "backups",
      label: "Backups",
      hint: backupHint,
      enabled: true,
      run: () => backupsFlow(runtime),
    },
  ];
  return items.filter((item) => item.enabled && !disabled.has(item.id));
}

async function backupSummary(runtime: LoadedRuntime): Promise<string> {
  const snapshots = await listBackups(runtime.options.cwd, runtime.config);
  if (snapshots.length === 0) {
    return "none yet";
  }
  const total = snapshots.reduce((sum, snapshot) => sum + backupsTask.snapshotSize(snapshot), 0);
  return `${snapshots.length} snapshot(s), ${backupsTask.formatSize(total)}, restore or open`;
}

/** Offer to create tug.toml when none exists. Returns false if the user declines. */
async function ensureConfig(options: RuntimeOptions): Promise<boolean> {
  if (options.configPath || (await findConfigPath(options.cwd))) {
    return true;
  }
  log.warn("No tug.toml found in this folder or any parent folder.");
  const setUp = await confirm({ message: "Set up tug for this project now?" });
  if (isCancel(setUp) || !setUp) {
    return false;
  }
  return (await initWizard(options.cwd)) !== null;
}

/**
 * The interactive mode: pick a task, see what it will do, confirm, watch it run,
 * then come back to the list. Output stays in normal terminal scrollback.
 */
export async function startInteractive(options: RuntimeOptions): Promise<void> {
  intro(styleText("bold", " tug "));
  try {
    if (!(await ensureConfig(options))) {
      outro("Run `tug init` when you're ready.");
      return;
    }
  } catch (error) {
    if (error instanceof PromptCancelled) {
      outro("Setup cancelled.");
      return;
    }
    throw error;
  }

  const runtime = await createLoadedRuntime(options);
  const { config } = runtime;
  log.message(
    [
      styleText("bold", config.project.name ?? "Project"),
      styleText("dim", `${config.remote.user}@${config.remote.host}:${config.remote.app_path}`),
    ].join("\n"),
  );

  let last: string | undefined;
  while (true) {
    const items = menuItems(runtime, await backupSummary(runtime));
    const choice = await select({
      message: "What would you like to do?",
      initialValue: last,
      maxItems: 12,
      options: [
        ...items.map((item) => ({ value: item.id, label: item.label, hint: item.hint })),
        { value: "doctor", label: "Doctor", hint: "check tools, SSH, and database settings" },
        { value: "quit", label: "Quit" },
      ],
    });
    if (isCancel(choice) || choice === "quit") {
      break;
    }
    last = choice;

    try {
      if (choice === "doctor") {
        await doctorFlow(runtime.options);
      } else {
        await items.find((item) => item.id === choice)!.run();
      }
    } catch (error) {
      if (error instanceof PromptCancelled) {
        ui.warn("Cancelled. Nothing was changed.");
      } else {
        ui.error(errorMessage(error));
      }
    }
  }
  outro("Done.");
}
