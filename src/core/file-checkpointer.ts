/**
 * File-based checkpointer for LangGraph state persistence
 *
 * Saves workflow state to a JSON file, enabling:
 * - Resume after interruption (Ctrl+C, crash, etc.)
 * - Audit trail of workflow progress
 * - "Marathon Agent" capability for long-running tasks
 */

import fs from 'fs/promises';
import path from 'path';
import {
  BaseCheckpointSaver,
  Checkpoint,
  CheckpointMetadata,
  CheckpointTuple,
  PendingWrite,
} from '@langchain/langgraph';
import { RunnableConfig } from '@langchain/core/runnables';
import { logger } from '../utils/logger.js';

const STATE_FILE = '.devpost-upgrade-state.json';

interface PersistedState {
  threadId: string;
  checkpoint: Checkpoint;
  metadata: CheckpointMetadata;
  parentConfig?: RunnableConfig;
  pendingWrites: PendingWrite[];
  timestamp: string;
}

/**
 * File-based checkpoint saver for LangGraph
 * Persists state to a JSON file in the current directory
 */
export class FileCheckpointer extends BaseCheckpointSaver {
  private filepath: string;
  private cache: Map<string, PersistedState> = new Map();

  constructor(directory: string = process.cwd()) {
    super();
    this.filepath = path.join(directory, STATE_FILE);
  }

  /**
   * Get the state file path
   */
  getFilepath(): string {
    return this.filepath;
  }

  /**
   * Check if a saved state exists
   */
  async hasState(): Promise<boolean> {
    try {
      await fs.access(this.filepath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load state from file into cache
   */
  private async loadFromFile(): Promise<void> {
    try {
      const content = await fs.readFile(this.filepath, 'utf-8');
      const states: PersistedState[] = JSON.parse(content);
      this.cache.clear();
      for (const state of states) {
        this.cache.set(state.threadId, state);
      }
    } catch {
      // No file or invalid - start fresh
      this.cache.clear();
    }
  }

  /**
   * Save cache to file
   */
  private async saveToFile(): Promise<void> {
    const states = Array.from(this.cache.values());
    await fs.writeFile(this.filepath, JSON.stringify(states, null, 2));
  }

  /**
   * Get a checkpoint tuple by config
   */
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    await this.loadFromFile();

    const threadId = config.configurable?.thread_id as string;
    if (!threadId) return undefined;

    const state = this.cache.get(threadId);
    if (!state) return undefined;

    return {
      config: {
        configurable: {
          thread_id: threadId,
          checkpoint_id: state.checkpoint.id,
        },
      },
      checkpoint: state.checkpoint,
      metadata: state.metadata,
      parentConfig: state.parentConfig,
      pendingWrites: state.pendingWrites || [],
    };
  }

  /**
   * List checkpoints (we only keep the latest per thread)
   */
  async *list(
    config: RunnableConfig,
    options?: { limit?: number; before?: RunnableConfig }
  ): AsyncGenerator<CheckpointTuple> {
    await this.loadFromFile();

    const threadId = config.configurable?.thread_id as string;
    if (!threadId) return;

    const state = this.cache.get(threadId);
    if (!state) return;

    yield {
      config: {
        configurable: {
          thread_id: threadId,
          checkpoint_id: state.checkpoint.id,
        },
      },
      checkpoint: state.checkpoint,
      metadata: state.metadata,
      parentConfig: state.parentConfig,
      pendingWrites: state.pendingWrites || [],
    };
  }

  /**
   * Save a checkpoint
   */
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata
  ): Promise<RunnableConfig> {
    await this.loadFromFile();

    const threadId = config.configurable?.thread_id as string;
    if (!threadId) {
      throw new Error('thread_id is required in config.configurable');
    }

    const state: PersistedState = {
      threadId,
      checkpoint,
      metadata,
      parentConfig: config,
      pendingWrites: [],
      timestamp: new Date().toISOString(),
    };

    this.cache.set(threadId, state);
    await this.saveToFile();

    logger.debug(`State saved to ${this.filepath}`);

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  /**
   * Save pending writes
   */
  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string
  ): Promise<void> {
    await this.loadFromFile();

    const threadId = config.configurable?.thread_id as string;
    if (!threadId) return;

    const state = this.cache.get(threadId);
    if (state) {
      state.pendingWrites = [...(state.pendingWrites || []), ...writes];
      await this.saveToFile();
    }
  }

  /**
   * Delete saved state
   */
  async clear(): Promise<void> {
    this.cache.clear();
    try {
      await fs.unlink(this.filepath);
      logger.debug(`State file deleted: ${this.filepath}`);
    } catch {
      // File didn't exist
    }
  }

  /**
   * Get human-readable state summary
   */
  async getStateSummary(): Promise<string | null> {
    await this.loadFromFile();

    if (this.cache.size === 0) return null;

    const state = Array.from(this.cache.values())[0];
    if (!state) return null;

    const channelValues = state.checkpoint.channel_values as Record<string, unknown>;
    const phase = channelValues?.phase as string || 'unknown';
    const currentGroupIndex = channelValues?.currentGroupIndex as number || 0;
    const groups = channelValues?.groups as unknown[] || [];
    const packages = channelValues?.packages as unknown[] || [];

    return `Phase: ${phase}, Group: ${currentGroupIndex + 1}/${groups.length || '?'}, Packages: ${packages.length}`;
  }
}

/**
 * Create a file checkpointer for the current directory
 */
export function createFileCheckpointer(directory?: string): FileCheckpointer {
  return new FileCheckpointer(directory);
}
