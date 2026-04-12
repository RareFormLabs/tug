export function renderTaskRunner(args: {
  title: string;
  status: string;
  logs: string[];
}): string {
  return [`${args.title}`, "", `Status: ${args.status}`, "", ...args.logs.slice(-14)].join("\n");
}
