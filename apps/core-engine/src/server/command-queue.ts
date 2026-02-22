import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { CoreToExecutorCommand } from './executor-contract.js';

export interface QueuedCommand {
  command: CoreToExecutorCommand;
  enqueuedAt: string;
  attempts: number;
  lastAttemptAt?: string;
  status: 'pending' | 'delivered' | 'dlq';
  lastError?: string;
}

export interface CommandQueue {
  enqueue(command: CoreToExecutorCommand): void;
  listPending(): QueuedCommand[];
  markDelivered(executionId: string): void;
  markAttempted(executionId: string, reason: string): void;
  markDlq(executionId: string, reason: string): void;
}

export class InMemoryCommandQueue implements CommandQueue {
  private readonly entries = new Map<string, QueuedCommand>();

  enqueue(command: CoreToExecutorCommand): void {
    this.entries.set(command.executionId, {
      command,
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
    });
  }

  listPending(): QueuedCommand[] {
    return Array.from(this.entries.values()).filter((entry) => entry.status === 'pending');
  }

  markDelivered(executionId: string): void {
    const entry = this.entries.get(executionId);
    if (entry !== undefined) {
      entry.status = 'delivered';
      this.entries.set(executionId, entry);
    }
  }

  markAttempted(executionId: string, reason: string): void {
    const entry = this.entries.get(executionId);
    if (entry !== undefined) {
      entry.attempts += 1;
      entry.lastAttemptAt = new Date().toISOString();
      entry.lastError = reason.length > 0 ? reason : undefined;
      this.entries.set(executionId, entry);
    }
  }

  markDlq(executionId: string, reason: string): void {
    const entry = this.entries.get(executionId);
    if (entry !== undefined) {
      entry.status = 'dlq';
      entry.lastError = reason;
      this.entries.set(executionId, entry);
    }
  }
}

export class FileBackedCommandQueue implements CommandQueue {
  private readonly cache = new Map<string, QueuedCommand>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  enqueue(command: CoreToExecutorCommand): void {
    this.cache.set(command.executionId, {
      command,
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
    });
    this.flush();
  }

  listPending(): QueuedCommand[] {
    return Array.from(this.cache.values()).filter((entry) => entry.status === 'pending');
  }

  markDelivered(executionId: string): void {
    const entry = this.cache.get(executionId);
    if (entry !== undefined) {
      entry.status = 'delivered';
      this.cache.set(executionId, entry);
      this.flush();
    }
  }

  markAttempted(executionId: string, reason: string): void {
    const entry = this.cache.get(executionId);
    if (entry !== undefined) {
      entry.attempts += 1;
      entry.lastAttemptAt = new Date().toISOString();
      entry.lastError = reason.length > 0 ? reason : undefined;
      this.cache.set(executionId, entry);
      this.flush();
    }
  }

  markDlq(executionId: string, reason: string): void {
    const entry = this.cache.get(executionId);
    if (entry !== undefined) {
      entry.status = 'dlq';
      entry.lastError = reason;
      this.cache.set(executionId, entry);
      this.flush();
    }
  }

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [executionId, value] of Object.entries(parsed)) {
        this.cache.set(executionId, value as QueuedCommand);
      }
    } catch {
      return;
    }
  }

  private flush(): void {
    const directory = dirname(this.filePath);
    mkdirSync(directory, { recursive: true });

    const payload: Record<string, QueuedCommand> = {};
    for (const [executionId, entry] of this.cache.entries()) {
      payload[executionId] = entry;
    }

    const temporaryFile = `${this.filePath}.tmp`;
    writeFileSync(temporaryFile, JSON.stringify(payload), 'utf8');
    renameSync(temporaryFile, this.filePath);
  }
}
