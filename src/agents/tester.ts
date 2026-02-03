/**
 * Test runner - executes build and test commands
 */

import { execa } from 'execa';
import { TestResult } from '../types.js';
import { logger } from '../utils/logger.js';

export class TestRunner {
  /**
   * Run build command
   */
  async runBuild(buildCommand: string): Promise<TestResult> {
    logger.startSpinner('Running build...');

    try {
      const [cmd, ...args] = this.parseCommand(buildCommand);
      const result = await execa(cmd, args, {
        reject: false,
        all: true,
      });

      const success = result.exitCode === 0;

      if (success) {
        logger.succeedSpinner('Build passed ✓');
      } else {
        logger.failSpinner('Build failed ✗');
        logger.debug('Build output:', result.all);
      }

      return {
        success,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.exitCode || 0,
      };
    } catch (error) {
      logger.failSpinner('Build failed with error');
      return {
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      };
    }
  }

  /**
   * Run test command
   */
  async runTests(testCommand: string): Promise<TestResult> {
    logger.startSpinner('Running tests...');

    try {
      const [cmd, ...args] = this.parseCommand(testCommand);
      const result = await execa(cmd, args, {
        reject: false,
        all: true,
      });

      const success = result.exitCode === 0;

      if (success) {
        logger.succeedSpinner('Tests passed ✓');
      } else {
        logger.failSpinner('Tests failed ✗');
        logger.debug('Test output:', result.all);
      }

      return {
        success,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.exitCode || 0,
      };
    } catch (error) {
      logger.failSpinner('Tests failed with error');
      return {
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      };
    }
  }

  /**
   * Run both build and test
   */
  async runAll(buildCommand: string, testCommand: string): Promise<{
    build: TestResult;
    test: TestResult;
    success: boolean;
  }> {
    const build = await this.runBuild(buildCommand);

    if (!build.success) {
      return {
        build,
        test: { success: false, stdout: '', stderr: 'Skipped due to build failure', exitCode: 1 },
        success: false,
      };
    }

    const test = await this.runTests(testCommand);

    return {
      build,
      test,
      success: build.success && test.success,
    };
  }

  /**
   * Extract error messages from test output
   */
  extractErrors(result: TestResult): string[] {
    const errors: string[] = [];
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    // Common error patterns
    const errorPatterns = [
      // TypeScript errors
      /error TS\d+: (.+)/g,
      // ESLint errors
      /✖ \d+ problems? \((\d+) errors?.+/g,
      // Jest/Vitest errors
      /● (.+)/g,
      // Generic stack traces
      /Error: (.+)/g,
      // Build tool errors
      /ERROR in (.+)/g,
    ];

    for (const pattern of errorPatterns) {
      const matches = [...combinedOutput.matchAll(pattern)];
      for (const match of matches) {
        if (match[1]) {
          errors.push(match[1].trim());
        }
      }
    }

    // If no specific errors found, return first few lines of stderr
    if (errors.length === 0 && result.stderr) {
      const lines = result.stderr.split('\n').filter((line) => line.trim().length > 0);
      return lines.slice(0, 10);
    }

    return errors.slice(0, 10); // Limit to 10 errors
  }

  /**
   * Get files mentioned in error messages
   */
  extractErrorFiles(result: TestResult): string[] {
    const files = new Set<string>();
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    // Match file paths (various formats)
    const filePatterns = [
      // TypeScript: src/file.ts(10,5)
      /([a-zA-Z0-9_\-\/\.]+\.[tj]sx?)\(\d+,\d+\)/g,
      // Jest: at Object.<anonymous> (src/file.ts:10:5)
      /\(([a-zA-Z0-9_\-\/\.]+\.[tj]sx?):\d+:\d+\)/g,
      // Generic: src/file.ts:10:5
      /([a-zA-Z0-9_\-\/\.]+\.[tj]sx?):\d+:\d+/g,
    ];

    for (const pattern of filePatterns) {
      const matches = [...combinedOutput.matchAll(pattern)];
      for (const match of matches) {
        if (match[1]) {
          files.add(match[1]);
        }
      }
    }

    return Array.from(files);
  }

  /**
   * Parse command string into cmd and args
   */
  private parseCommand(command: string): string[] {
    // Simple parsing - split by spaces, but handle quoted strings
    const parts: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < command.length; i++) {
      const char = command[i];

      if (char === '"' || char === "'") {
        inQuotes = !inQuotes;
      } else if (char === ' ' && !inQuotes) {
        if (current) {
          parts.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      parts.push(current);
    }

    return parts;
  }

  /**
   * Check if a script exists in package.json
   */
  async hasScript(scriptName: string): Promise<boolean> {
    try {
      const { readFile } = await import('fs/promises');
      const packageJson = JSON.parse(await readFile('package.json', 'utf-8'));
      return !!packageJson.scripts?.[scriptName];
    } catch {
      return false;
    }
  }
}
