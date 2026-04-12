import {
  BoxRenderable,
  CliRenderEvents,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  createCliRenderer,
} from "@opentui/core";
import { inspectProject } from "../core/doctor";
import { createLoadedRuntime } from "../core/runtime";
import * as backupsTask from "../tasks/backups";
import * as composerTask from "../tasks/composer";
import * as databaseTask from "../tasks/database";
import * as folderTask from "../tasks/folder";
import * as shellTask from "../tasks/shell";
import { taskDescriptors } from "../tasks";
import type {
  DoctorReport,
  LoadedRuntime,
  RuntimeOptions,
  TaskDescriptor,
} from "../types";
import { formatConfirmation } from "./components/confirmation-dialog";
import { renderDashboardDetails } from "./screens/dashboard";
import { renderTaskRunner } from "./screens/task-runner";

interface InteractiveTask {
  descriptor: TaskDescriptor;
  execute: (runtime: LoadedRuntime) => Promise<{ summary: string }>;
  confirm: (runtime: LoadedRuntime) => Promise<string>;
  destructive: boolean;
}

function enabledTasks(runtime: LoadedRuntime): InteractiveTask[] {
  return taskDescriptors
    .filter(
      (task) =>
        task.disabledBy !== "composer" || runtime.config.composer.enabled,
    )
    .filter((task) => !runtime.config.project.disabled_tasks.includes(task.id))
    .map((descriptor) => {
      switch (descriptor.id) {
        case "folderPull":
          return {
            descriptor,
            execute: (runtime) =>
              folderTask.run(
                { ...runtime, options: { ...runtime.options, force: true } },
                "pull",
              ),
            confirm: (runtime) => folderTask.confirmMessage(runtime, "pull"),
            destructive: false,
          };
        case "folderPush":
          return {
            descriptor,
            execute: (runtime) =>
              folderTask.run(
                { ...runtime, options: { ...runtime.options, force: true } },
                "push",
              ),
            confirm: (runtime) => folderTask.confirmMessage(runtime, "push"),
            destructive: true,
          };
        case "databasePull":
          return {
            descriptor,
            execute: (runtime) =>
              databaseTask.run(
                { ...runtime, options: { ...runtime.options, force: true } },
                "pull",
              ),
            confirm: (runtime) => databaseTask.confirmMessage(runtime, "pull"),
            destructive: true,
          };
        case "databasePush":
          return {
            descriptor,
            execute: (runtime) =>
              databaseTask.run(
                { ...runtime, options: { ...runtime.options, force: true } },
                "push",
              ),
            confirm: (runtime) => databaseTask.confirmMessage(runtime, "push"),
            destructive: true,
          };
        case "composerPull":
          return {
            descriptor,
            execute: (runtime) =>
              composerTask.run(
                { ...runtime, options: { ...runtime.options, force: true } },
                "pull",
              ),
            confirm: (runtime) => composerTask.confirmMessage(runtime, "pull"),
            destructive: true,
          };
        case "composerPush":
          return {
            descriptor,
            execute: (runtime) =>
              composerTask.run(
                { ...runtime, options: { ...runtime.options, force: true } },
                "push",
              ),
            confirm: (runtime) => composerTask.confirmMessage(runtime, "push"),
            destructive: true,
          };
        case "backups":
          return {
            descriptor,
            execute: (runtime) => backupsTask.run(runtime, "list"),
            confirm: async () => "List backups?",
            destructive: false,
          };
        case "terminal":
          return {
            descriptor,
            execute: (runtime) => shellTask.run(runtime),
            confirm: () => shellTask.confirmMessage(),
            destructive: false,
          };
        default:
          throw new Error(`Unknown task ${descriptor.id}`);
      }
    });
}

export async function startTui(options: RuntimeOptions): Promise<void> {
  const runtime = await createLoadedRuntime({ ...options, interactive: true });
  let doctorReport: DoctorReport = {
    ok: true,
    checks: [
      {
        id: "preflight",
        label: "Preflight",
        status: "warn" as const,
        message: "Running checks...",
      },
    ],
  };
  const tasks = enabledTasks(runtime);
  if (tasks.length === 0) {
    throw new Error("No enabled tasks are available.");
  }

  const renderer = await createCliRenderer({
    useAlternateScreen: true,
    useConsole: process.env.NODE_ENV !== "production",
    openConsoleOnError: true,
    exitOnCtrlC: false,
  });

  let selectedIndex = 0;
  let lastSummary = "";
  let confirmMode = false;
  let activeTask: InteractiveTask | null = null;
  let running = false;

  const root = new BoxRenderable(renderer, {
    width: "100%",
    height: "100%",
    flexDirection: "column",
    padding: 1,
    gap: 1,
    backgroundColor: "#111111",
  });

  const topRow = new BoxRenderable(renderer, {
    flexDirection: "row",
    flexGrow: 1,
    gap: 1,
    width: "100%",
  });
  const leftPane = new BoxRenderable(renderer, {
    width: 60,
    border: true,
    borderStyle: "single",
    title: "Tasks",
  });
  const rightPane = new BoxRenderable(renderer, {
    flexGrow: 1,
    border: true,
    borderStyle: "single",
    title: "Details",
    padding: 1,
  });
  const logPane = new BoxRenderable(renderer, {
    height: 18,
    border: true,
    borderStyle: "single",
    title: "Run Log",
    padding: 1,
  });
  const select = new SelectRenderable(renderer, {
    width: "100%",
    height: "100%",
    options: tasks.map((task) => ({
      name: task.descriptor.title,
      description: task.descriptor.description,
    })),
  });
  const detailsText = new TextRenderable(renderer, {
    content: "",
  });
  const logText = new TextRenderable(renderer, {
    content: "Ready.",
  });
  const modal = new BoxRenderable(renderer, {
    position: "absolute",
    left: 10,
    top: 6,
    width: "70%",
    height: 9,
    border: true,
    borderStyle: "double",
    title: "Confirm",
    padding: 1,
    backgroundColor: "#1b1b1b",
  });
  const modalText = new TextRenderable(renderer, { content: "" });

  modal.add(modalText);
  leftPane.add(select);
  rightPane.add(detailsText);
  logPane.add(logText);
  topRow.add(leftPane);
  topRow.add(rightPane);
  root.add(topRow);
  root.add(logPane);
  renderer.root.add(root);

  const updateDetails = (): void => {
    const selectedTask = tasks[selectedIndex]!.descriptor;
    detailsText.content = renderDashboardDetails({
      config: runtime.config,
      selectedTask,
      doctor: doctorReport,
      lastSummary,
    });
  };

  const updateLogs = (status: string): void => {
    logText.content = renderTaskRunner({
      title: activeTask?.descriptor.title ?? "No active task",
      status,
      logs: runtime.logger.snapshot(),
    });
  };

  runtime.logger.subscribe(() => {
    updateLogs(running ? "running" : "idle");
  });

  const hideModal = (): void => {
    if (confirmMode) {
      root.remove(modal.id);
    }
    confirmMode = false;
    modalText.content = "";
  };

  const showModal = (text: string): void => {
    confirmMode = true;
    modalText.content = formatConfirmation(text);
    if (!root.getChildren().some((child) => child.id === modal.id)) {
      root.add(modal);
    }
  };

  const executeTask = async (task: InteractiveTask): Promise<void> => {
    activeTask = task;
    runtime.logger.clear();
    running = true;
    updateLogs("running");

    if (task.descriptor.id === "terminal") {
      renderer.destroy();
      try {
        const result = await task.execute(runtime);
        console.log(result.summary);
        process.exitCode = 0;
      } catch (error) {
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        console.error(message);
        process.exitCode = 1;
      }
      return;
    }

    try {
      const result = await task.execute(runtime);
      lastSummary = result.summary;
    } catch (error) {
      lastSummary = error instanceof Error ? error.message : "Task failed.";
      runtime.logger.add(lastSummary);
    } finally {
      running = false;
      activeTask = null;
      updateDetails();
      updateLogs("idle");
    }
  };

  select.on(SelectRenderableEvents.SELECTION_CHANGED, (index: number) => {
    selectedIndex = index;
    updateDetails();
  });
  select.on(SelectRenderableEvents.ITEM_SELECTED, async () => {
    if (running) {
      return;
    }
    const selected = tasks[selectedIndex]!;
    if (selected.destructive) {
      showModal(await selected.confirm(runtime));
      activeTask = selected;
      return;
    }
    await executeTask(selected);
  });

  renderer.keyInput.on("keypress", async (key) => {
    if (key.ctrl && key.name === "c") {
      renderer.destroy();
      process.exitCode = 130;
      return;
    }
    if (key.name === "q" && !running && !confirmMode) {
      renderer.destroy();
      process.exitCode = 0;
      return;
    }
    if (key.name === "escape" && confirmMode) {
      hideModal();
      activeTask = null;
      return;
    }
    if (key.name === "`" && process.env.NODE_ENV !== "production") {
      renderer.console.toggle();
      return;
    }
    if (confirmMode && key.name === "return" && activeTask) {
      hideModal();
      await executeTask(activeTask);
    }
  });

  renderer.on(CliRenderEvents.DESTROY, () => {});

  updateDetails();
  updateLogs("idle");
  select.focus();
  renderer.start();

  void inspectProject(runtime.options, runtime.runner)
    .then((report) => {
      doctorReport = report;
      updateDetails();
    })
    .catch((error) => {
      doctorReport = {
        ok: false,
        checks: [
          {
            id: "preflight-error",
            label: "Preflight",
            status: "warn",
            message:
              error instanceof Error ? error.message : "Preflight failed.",
          },
        ],
      };
      updateDetails();
    });
}
