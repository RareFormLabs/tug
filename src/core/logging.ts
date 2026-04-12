import type { Logger } from "../types";

export class MemoryLogger implements Logger {
  #lines: string[] = [];
  #listeners = new Set<(lines: string[]) => void>();

  add(line: string): void {
    this.#lines = [...this.#lines, line];
    for (const listener of this.#listeners) {
      listener(this.snapshot());
    }
  }

  clear(): void {
    this.#lines = [];
    for (const listener of this.#listeners) {
      listener([]);
    }
  }

  snapshot(): string[] {
    return [...this.#lines];
  }

  subscribe(listener: (lines: string[]) => void): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
