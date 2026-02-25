import { randomUUID } from 'node:crypto';

import { DeadLetterEntry } from './types.js';

function nowIso(): string {
  return new Date().toISOString();
}

export class DeadLetterQueue {
  private readonly entries = new Map<string, DeadLetterEntry>();

  add(input: Omit<DeadLetterEntry, 'id' | 'createdAt' | 'lastAttemptAt' | 'archived'>): DeadLetterEntry {
    const timestamp = nowIso();
    const entry: DeadLetterEntry = {
      id: randomUUID(),
      createdAt: timestamp,
      lastAttemptAt: timestamp,
      archived: false,
      ...input,
    };

    this.entries.set(entry.id, entry);
    return entry;
  }

  getById(id: string): DeadLetterEntry | null {
    return this.entries.get(id) ?? null;
  }

  listActive(): DeadLetterEntry[] {
    return Array.from(this.entries.values()).filter((entry) => !entry.archived);
  }

  retry(id: string): DeadLetterEntry {
    const current = this.entries.get(id);
    if (current === undefined) {
      throw new Error(`Dead letter not found: ${id}`);
    }

    const updated: DeadLetterEntry = {
      ...current,
      attempts: current.attempts + 1,
      lastAttemptAt: nowIso(),
    };
    this.entries.set(id, updated);
    return updated;
  }

  archive(id: string): DeadLetterEntry {
    const current = this.entries.get(id);
    if (current === undefined) {
      throw new Error(`Dead letter not found: ${id}`);
    }

    const updated: DeadLetterEntry = {
      ...current,
      archived: true,
      lastAttemptAt: nowIso(),
    };
    this.entries.set(id, updated);
    return updated;
  }

  purgeOlderThan(retentionDays: number): number {
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let removedCount = 0;

    for (const [id, entry] of this.entries.entries()) {
      const createdAt = new Date(entry.createdAt).getTime();
      if (createdAt <= cutoffTime) {
        this.entries.delete(id);
        removedCount += 1;
      }
    }

    return removedCount;
  }
}