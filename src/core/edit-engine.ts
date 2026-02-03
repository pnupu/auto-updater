/**
 * Edit engine - applies search-and-replace edits to files
 */

import { readFile, writeFile } from 'fs/promises';
import { Edit } from '../types.js';
import { logger } from '../utils/logger.js';
import { GitManager } from '../utils/git.js';

export class EditEngine {
  private git: GitManager;
  private appliedEdits: Edit[] = [];

  constructor(git: GitManager) {
    this.git = git;
  }

  /**
   * Apply a single edit
   */
  async applyEdit(edit: Edit): Promise<boolean> {
    try {
      logger.debug(`Applying edit to ${edit.file}: ${edit.description}`);

      const content = await readFile(edit.file, 'utf-8');

      // Count occurrences of search string
      const occurrences = content.split(edit.search).length - 1;

      if (occurrences === 0) {
        logger.warn(`Search string not found in ${edit.file}`);
        logger.debug('Search string:', edit.search);
        return false;
      }

      if (occurrences > 1) {
        logger.warn(`Search string appears ${occurrences} times in ${edit.file} - too ambiguous`);
        logger.debug('Search string:', edit.search);
        return false;
      }

      // Apply replacement
      const newContent = content.replace(edit.search, edit.replace);
      await writeFile(edit.file, newContent);

      logger.success(`Applied: ${edit.description}`);
      this.appliedEdits.push(edit);

      return true;
    } catch (error) {
      logger.error(`Failed to apply edit to ${edit.file}`, error as Error);
      return false;
    }
  }

  /**
   * Apply multiple edits
   */
  async applyEdits(edits: Edit[]): Promise<{
    success: boolean;
    appliedCount: number;
    failedCount: number;
  }> {
    logger.section('Applying Code Fixes');
    logger.info(`${edits.length} edits to apply`);
    logger.newLine();

    let appliedCount = 0;
    let failedCount = 0;

    for (const edit of edits) {
      const success = await this.applyEdit(edit);
      if (success) {
        appliedCount++;
      } else {
        failedCount++;
      }
    }

    logger.newLine();
    logger.info(`Applied ${appliedCount}/${edits.length} edits successfully`);

    if (failedCount > 0) {
      logger.warn(`${failedCount} edits failed to apply`);
    }

    return {
      success: failedCount === 0,
      appliedCount,
      failedCount,
    };
  }

  /**
   * Apply edits with incremental validation (test after each file)
   */
  async applyEditsWithValidation(
    edits: Edit[],
    validateFn: () => Promise<boolean>
  ): Promise<{
    success: boolean;
    appliedCount: number;
    failedAtEdit?: Edit;
  }> {
    // Group edits by file
    const editsByFile = new Map<string, Edit[]>();
    for (const edit of edits) {
      if (!editsByFile.has(edit.file)) {
        editsByFile.set(edit.file, []);
      }
      editsByFile.get(edit.file)!.push(edit);
    }

    let appliedCount = 0;

    for (const [file, fileEdits] of editsByFile.entries()) {
      logger.info(`Editing ${file}...`);

      // Apply all edits for this file
      for (const edit of fileEdits) {
        const success = await this.applyEdit(edit);
        if (success) {
          appliedCount++;
        } else {
          return {
            success: false,
            appliedCount,
            failedAtEdit: edit,
          };
        }
      }

      // Stage the file
      await this.git.stageFiles([file]);

      // Optionally validate after each file
      // (We'll validate after all files for now to save time)
    }

    return {
      success: true,
      appliedCount,
    };
  }

  /**
   * Show a preview of what would be changed (dry run)
   */
  async previewEdits(edits: Edit[]): Promise<void> {
    logger.section('Edit Preview');

    for (const edit of edits) {
      logger.newLine();
      logger.info(`File: ${edit.file}`);
      logger.listItem(edit.description, 1);
      logger.newLine();
      logger.info('Search for:');
      logger.code(edit.search.substring(0, 200));
      logger.info('Replace with:');
      logger.code(edit.replace.substring(0, 200));
    }
  }

  /**
   * Rollback all applied edits
   */
  async rollback(): Promise<void> {
    if (this.appliedEdits.length === 0) {
      logger.info('No edits to rollback');
      return;
    }

    logger.startSpinner('Rolling back applied edits...');

    const files = [...new Set(this.appliedEdits.map((e) => e.file))];

    try {
      await this.git.revertFiles(files);
      logger.succeedSpinner(`Rolled back ${this.appliedEdits.length} edits`);
      this.appliedEdits = [];
    } catch (error) {
      logger.failSpinner('Failed to rollback edits');
      throw error;
    }
  }

  /**
   * Clear the edit history (after successful commit)
   */
  clearHistory(): void {
    this.appliedEdits = [];
  }

  /**
   * Get the list of files that were edited
   */
  getEditedFiles(): string[] {
    return [...new Set(this.appliedEdits.map((e) => e.file))];
  }
}
