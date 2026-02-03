/**
 * Git operations wrapper using simple-git
 */

import simpleGit, { SimpleGit, StatusResult } from 'simple-git';
import { logger } from './logger.js';
import { PackageInfo } from '../types.js';

export class GitManager {
  private git: SimpleGit;

  constructor() {
    this.git = simpleGit();
  }

  /**
   * Check if current directory is a git repository
   */
  async isGitRepo(): Promise<boolean> {
    try {
      await this.git.status();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current git status
   */
  async getStatus(): Promise<StatusResult> {
    return await this.git.status();
  }

  /**
   * Check if working directory is clean
   */
  async isClean(): Promise<boolean> {
    const status = await this.getStatus();
    return status.isClean();
  }

  /**
   * Stage specific files
   */
  async stageFiles(files: string[]): Promise<void> {
    await this.git.add(files);
    logger.debug(`Staged files: ${files.join(', ')}`);
  }

  /**
   * Stage all changes
   */
  async stageAll(): Promise<void> {
    await this.git.add('.');
    logger.debug('Staged all changes');
  }

  /**
   * Create a commit
   */
  async commit(message: string): Promise<void> {
    try {
      await this.git.commit(message);
      logger.success(`Committed: ${message}`);
    } catch (error) {
      logger.error('Failed to create commit', error as Error);
      throw error;
    }
  }

  /**
   * Create a commit for package updates
   */
  async commitPackageUpdate(packages: PackageInfo[]): Promise<void> {
    const packageNames = packages.map((p) => p.name).join(', ');
    const message = this.generateCommitMessage(packages);

    await this.stageFiles(['package.json', 'package-lock.json']);
    await this.commit(message);
  }

  /**
   * Generate a descriptive commit message for package updates
   */
  private generateCommitMessage(packages: PackageInfo[]): string {
    if (packages.length === 1) {
      const pkg = packages[0];
      return `chore(deps): upgrade ${pkg.name} from ${pkg.currentVersion} to ${pkg.latestVersion}\n\nCo-Authored-By: Devpost Auto-Upgrader <noreply@devpost.com>`;
    }

    const packageList = packages
      .map((p) => `  - ${p.name}: ${p.currentVersion} → ${p.latestVersion}`)
      .join('\n');

    return `chore(deps): upgrade ${packages.length} packages\n\n${packageList}\n\nCo-Authored-By: Devpost Auto-Upgrader <noreply@devpost.com>`;
  }

  /**
   * Unstage files
   */
  async unstageFiles(files: string[]): Promise<void> {
    await this.git.reset(['--', ...files]);
    logger.debug(`Unstaged files: ${files.join(', ')}`);
  }

  /**
   * Revert file changes (discard working directory changes)
   */
  async revertFiles(files: string[]): Promise<void> {
    try {
      await this.git.checkout(['--', ...files]);
      logger.debug(`Reverted files: ${files.join(', ')}`);
    } catch (error) {
      logger.error('Failed to revert files', error as Error);
      throw error;
    }
  }

  /**
   * Revert all uncommitted changes
   */
  async revertAll(): Promise<void> {
    try {
      await this.git.reset(['--hard']);
      logger.info('Reverted all uncommitted changes');
    } catch (error) {
      logger.error('Failed to revert changes', error as Error);
      throw error;
    }
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(): Promise<string> {
    const status = await this.getStatus();
    return status.current || 'unknown';
  }

  /**
   * Get last commit message
   */
  async getLastCommitMessage(): Promise<string> {
    const log = await this.git.log({ maxCount: 1 });
    return log.latest?.message || '';
  }

  /**
   * Get git diff for specific files
   */
  async getDiff(files?: string[]): Promise<string> {
    if (files && files.length > 0) {
      return await this.git.diff(['--', ...files]);
    }
    return await this.git.diff();
  }

  /**
   * Check if there are uncommitted changes
   */
  async hasUncommittedChanges(): Promise<boolean> {
    const status = await this.getStatus();
    return !status.isClean();
  }

  /**
   * Warn user about uncommitted changes
   */
  async warnUncommittedChanges(): Promise<void> {
    const hasChanges = await this.hasUncommittedChanges();

    if (hasChanges) {
      logger.warn('You have uncommitted changes in your working directory');
      logger.info('Consider committing or stashing them before running the upgrader');

      const status = await this.getStatus();
      if (status.modified.length > 0) {
        logger.listItem(`Modified: ${status.modified.length} files`, 1);
      }
      if (status.created.length > 0) {
        logger.listItem(`New: ${status.created.length} files`, 1);
      }
      if (status.deleted.length > 0) {
        logger.listItem(`Deleted: ${status.deleted.length} files`, 1);
      }
      logger.newLine();
    }
  }
}
