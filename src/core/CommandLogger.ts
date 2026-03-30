import * as vscode from 'vscode';
import {
  CommandEntry, CommandTag, CommandStatus,
  StoredData, STORAGE_VERSION,
} from '../types';

const STORAGE_KEY = 'terminalBuddy.commandHistory';

export class CommandLogger {
  private entries: CommandEntry[] = [];
  private readonly context: vscode.ExtensionContext;
  private writePromise: Promise<void> = Promise.resolve();

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.load();
  }

  // ── Load from storage (with migration) ─────────────────────────────────
  private load(): void {
    try {
      const raw = this.context.globalState.get<StoredData | CommandEntry[]>(STORAGE_KEY);
      if (!raw) {
        this.entries = [];
        return;
      }

      // Migration: old format was just CommandEntry[]
      if (Array.isArray(raw)) {
        this.entries = raw;
        this.save(); // re-save in new format
        return;
      }

      if (raw.version === STORAGE_VERSION) {
        this.entries = raw.entries ?? [];
      } else {
        // Future migration logic goes here
        this.entries = raw.entries ?? [];
      }
    } catch {
      console.warn('[Terminal Buddy] Failed to load command history, resetting.');
      this.entries = [];
    }
  }

  // ── Save to storage (serialized write queue) ───────────────────────────
  private save(): void {
    this.writePromise = this.writePromise.then(async () => {
      try {
        const data: StoredData = {
          version: STORAGE_VERSION,
          entries: this.entries,
        };
        await this.context.globalState.update(STORAGE_KEY, data);
      } catch (err) {
        console.error('[Terminal Buddy] Failed to save command history:', err);
      }
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────

  async add(entry: CommandEntry): Promise<void> {
    const maxItems = vscode.workspace.getConfiguration('terminalBuddy')
      .get<number>('maxHistoryItems', 500);

    this.entries.unshift(entry);

    if (this.entries.length > maxItems) {
      this.entries = this.entries.slice(0, maxItems);
    }

    this.save();
  }

  getAll(): CommandEntry[] {
    return this.entries;
  }

  getRecent(n: number): CommandEntry[] {
    return this.entries.slice(0, n);
  }

  getByTag(tag: CommandTag): CommandEntry[] {
    return this.entries.filter((e) => e.tag === tag);
  }

  getByStatus(status: CommandStatus): CommandEntry[] {
    return this.entries.filter((e) => e.status === status);
  }

  search(query: string): CommandEntry[] {
    if (!query.trim()) { return this.entries; }

    const words = query.toLowerCase().split(/\s+/).filter(Boolean);

    return this.entries.filter((entry) => {
      const haystack = `${entry.cmd} ${entry.cwd} ${entry.project}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }

  async clear(): Promise<void> {
    this.entries = [];
    this.save();
  }

  getStats(): { total: number; ok: number; error: number; warning: number } {
    let ok = 0, error = 0, warning = 0;
    for (const e of this.entries) {
      if (e.status === 'ok') { ok++; }
      else if (e.status === 'error') { error++; }
      else if (e.status === 'warning') { warning++; }
    }
    return { total: this.entries.length, ok, error, warning };
  }

  getLastError(): CommandEntry | null {
    return this.entries.find(e => e.status === 'error') || null;
  }
}
