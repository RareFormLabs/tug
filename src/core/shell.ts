export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function joinCommand(parts: string[]): string {
  return parts.join(" ");
}
