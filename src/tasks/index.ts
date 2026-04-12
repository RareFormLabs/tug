import type { TaskDescriptor } from "../types";

export const taskDescriptors: TaskDescriptor[] = [
  {
    id: "folderPull",
    title: "Folder pull",
    description: "Sync configured remote folders into the local project.",
    action: "pull",
  },
  {
    id: "folderPush",
    title: "Folder push",
    description: "Sync configured local folders to the remote project.",
    action: "push",
  },
  {
    id: "databasePull",
    title: "Database pull",
    description: "Replace the local database with a remote dump.",
    action: "pull",
  },
  {
    id: "databasePush",
    title: "Database push",
    description: "Replace the remote database with a local dump.",
    action: "push",
  },
  {
    id: "composerPull",
    title: "Composer pull",
    description: "Replace local composer files from the remote app.",
    disabledBy: "composer",
    action: "pull",
  },
  {
    id: "composerPush",
    title: "Composer push",
    description: "Upload local composer files to the remote app.",
    disabledBy: "composer",
    action: "push",
  },
  {
    id: "backups",
    title: "View backups",
    description: "List and open backup snapshots.",
    action: "list",
  },
  {
    id: "terminal",
    title: "Remote shell",
    description: "Open a shell in the remote app path.",
    action: "shell",
  },
];
