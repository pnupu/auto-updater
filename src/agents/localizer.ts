/**
 * Localizer - identifies which files need fixes based on error messages
 * Inspired by SWE-agent's localization approach
 */

import { TestResult } from '../types.js';
import { RepoMapper } from '../core/repo-mapper.js';
import { logger } from '../utils/logger.js';

export class Localizer {
  private repoMapper: RepoMapper;

  constructor(repoMapper: RepoMapper) {
    this.repoMapper = repoMapper;
  }

  /**
   * Localize errors to specific files
   */
  async localize(testResult: TestResult, packageName: string): Promise<string[]> {
    logger.startSpinner('Localizing errors to files...');

    const files = new Set<string>();

    // 1. Extract files from error messages
    const errorFiles = this.extractFilesFromErrors(testResult);
    errorFiles.forEach((f) => files.add(f));
    logger.debug(`Found ${errorFiles.length} files from error messages`);

    // 2. Find files that import the upgraded package
    const importingFiles = await this.repoMapper.findFilesImporting(packageName);
    importingFiles.forEach((f) => files.add(f));
    logger.debug(`Found ${importingFiles.length} files importing ${packageName}`);

    // 3. If we have few files, be more aggressive
    if (files.size < 3) {
      // Also check for common variations
      const packageShortName = packageName.split('/').pop() || packageName;
      if (packageShortName !== packageName) {
        const relatedFiles = await this.repoMapper.findFilesImporting(packageShortName);
        relatedFiles.forEach((f) => files.add(f));
        logger.debug(`Found ${relatedFiles.length} files importing ${packageShortName}`);
      }

      // For React packages, also look for react-dom imports
      if (packageName === 'react' || packageName === 'react-dom') {
        const reactFiles = await this.repoMapper.findFilesImporting('react');
        const reactDomFiles = await this.repoMapper.findFilesImporting('react-dom');
        reactFiles.forEach((f) => files.add(f));
        reactDomFiles.forEach((f) => files.add(f));
        logger.debug(`Found ${reactFiles.length} React files, ${reactDomFiles.length} ReactDOM files`);
      }
    }

    // 4. If still no files, get ALL source files as a last resort
    if (files.size === 0) {
      logger.debug('No specific files found, scanning all source files...');
      const map = await this.repoMapper.getMap();
      const allFiles = Array.from(map.files.keys());
      logger.debug(`Repository has ${allFiles.length} total files`);

      // Add files that likely use the package
      for (const file of allFiles) {
        if (file.includes('src/') || file.includes('lib/')) {
          files.add(file);
        }
      }
    }

    const fileList = Array.from(files);

    logger.succeedSpinner(`Localized to ${fileList.length} files`);

    if (fileList.length > 0) {
      logger.newLine();
      logger.info('Files to check:');
      fileList.forEach((file) => logger.listItem(file, 1));
    }

    return fileList;
  }

  /**
   * Extract file paths from error messages
   */
  private extractFilesFromErrors(testResult: TestResult): string[] {
    const files = new Set<string>();
    const combinedOutput = `${testResult.stdout}\n${testResult.stderr}`;

    // Match various file path patterns
    const patterns = [
      // Node.js ESM errors: file:///Users/.../file.js:10:5
      /file:\/\/([^\s:]+\.[tj]sx?):\d+/g,
      // TypeScript: src/file.ts(10,5)
      /([a-zA-Z0-9_\-\/\.]+\.[tj]sx?)\(\d+,\d+\)/g,
      // Jest: at Object.<anonymous> (src/file.ts:10:5)
      /\(([a-zA-Z0-9_\-\/\.]+\.[tj]sx?):\d+:\d+\)/g,
      // Generic: src/file.ts:10:5
      /([a-zA-Z0-9_\-\/\.]+\.[tj]sx?):\d+:\d+/g,
      // Import errors: Cannot find module './components/App'
      /Cannot find module ['"']([^'"']+)['"']/g,
      // Module not found: Error: Can't resolve 'react-dom/client'
      /Can't resolve ['"']([^'"']+)['"']/g,
    ];

    const cwd = process.cwd();

    for (const pattern of patterns) {
      const matches = [...combinedOutput.matchAll(pattern)];
      for (const match of matches) {
        if (match[1]) {
          // Clean up the path
          let file = match[1];

          // Remove leading ./
          file = file.replace(/^\.\//, '');

          // Convert absolute paths to relative
          if (file.startsWith(cwd)) {
            file = file.slice(cwd.length + 1); // +1 for the /
          } else if (file.startsWith('/')) {
            // Try to find cwd in the path
            const cwdIndex = file.indexOf(cwd.split('/').pop() || '');
            if (cwdIndex > 0) {
              const afterCwd = file.indexOf('/', cwdIndex);
              if (afterCwd > 0) {
                file = file.slice(afterCwd + 1);
              }
            }
          }

          // Only add if it looks like a real source file
          if (file.match(/\.[jt]sx?$/) && !file.startsWith('/')) {
            files.add(file);
          }
        }
      }
    }

    return Array.from(files);
  }

  /**
   * Prioritize files (most likely to need changes)
   */
  prioritizeFiles(files: string[]): string[] {
    // Prioritize by:
    // 1. Files in src/ directory
    // 2. Files with 'index' in the name
    // 3. Files with component/page in the path
    // 4. Everything else

    return files.sort((a, b) => {
      const scoreA = this.getFileScore(a);
      const scoreB = this.getFileScore(b);
      return scoreB - scoreA;
    });
  }

  /**
   * Calculate priority score for a file
   */
  private getFileScore(file: string): number {
    let score = 0;

    if (file.startsWith('src/')) score += 10;
    if (file.includes('index')) score += 5;
    if (file.includes('component') || file.includes('page')) score += 3;
    if (file.endsWith('.tsx') || file.endsWith('.jsx')) score += 2;
    if (file.includes('test') || file.includes('spec')) score -= 5; // Deprioritize tests

    return score;
  }
}
