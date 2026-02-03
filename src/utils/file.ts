/**
 * File utilities for reading and filtering source files
 */

import { readFile } from 'fs/promises';
import fg from 'fast-glob';
import ignore from 'ignore';
import { logger } from './logger.js';

export class FileManager {
  private ignoreFilter: ReturnType<typeof ignore> | null = null;

  /**
   * Initialize .gitignore filter
   */
  async initializeIgnoreFilter(): Promise<void> {
    try {
      const gitignoreContent = await readFile('.gitignore', 'utf-8');
      this.ignoreFilter = ignore().add(gitignoreContent);
      logger.debug('Loaded .gitignore patterns');
    } catch {
      // No .gitignore file, create default filter
      this.ignoreFilter = ignore().add([
        'node_modules/**',
        'dist/**',
        'build/**',
        '*.min.js',
        '*.bundle.js',
        'coverage/**',
        '.git/**',
      ]);
      logger.debug('Using default ignore patterns');
    }
  }

  /**
   * Find all source files (JS/TS) in the project
   */
  async findSourceFiles(): Promise<string[]> {
    if (!this.ignoreFilter) {
      await this.initializeIgnoreFilter();
    }

    logger.debug('Searching for source files...');

    // Find all JS/TS files
    const patterns = [
      'src/**/*.{js,jsx,ts,tsx}',
      'lib/**/*.{js,jsx,ts,tsx}',
      '*.{js,jsx,ts,tsx}',
      'test/**/*.{js,jsx,ts,tsx}',
      'tests/**/*.{js,jsx,ts,tsx}',
    ];

    const files = await fg(patterns, {
      ignore: ['node_modules/**', 'dist/**', 'build/**', '*.min.js'],
      absolute: false,
      dot: false,
    });

    // Additional filtering with .gitignore
    const filtered = this.ignoreFilter!.filter(files);

    logger.debug(`Found ${filtered.length} source files`);
    return filtered;
  }

  /**
   * Read file content
   */
  async readFile(path: string): Promise<string> {
    return await readFile(path, 'utf-8');
  }

  /**
   * Check if file should be ignored
   */
  shouldIgnore(path: string): boolean {
    if (!this.ignoreFilter) {
      return false;
    }
    return this.ignoreFilter.ignores(path);
  }

  /**
   * Get file extension
   */
  getExtension(path: string): string {
    const match = path.match(/\.([^.]+)$/);
    return match ? match[1] : '';
  }

  /**
   * Check if file is TypeScript
   */
  isTypeScript(path: string): boolean {
    const ext = this.getExtension(path);
    return ext === 'ts' || ext === 'tsx';
  }

  /**
   * Check if file is JavaScript
   */
  isJavaScript(path: string): boolean {
    const ext = this.getExtension(path);
    return ext === 'js' || ext === 'jsx';
  }
}
