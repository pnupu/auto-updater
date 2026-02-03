/**
 * Logging utilities with chalk and ora for beautiful CLI output
 */

import chalk from 'chalk';
import ora, { Ora } from 'ora';

class Logger {
  private spinner: Ora | null = null;
  private debugMode: boolean = false;

  constructor() {
    this.debugMode = process.env.DEBUG === 'true';
  }

  /**
   * Start a loading spinner with a message
   */
  startSpinner(message: string): void {
    if (this.spinner) {
      this.spinner.stop();
    }
    this.spinner = ora(message).start();
  }

  /**
   * Update the spinner message
   */
  updateSpinner(message: string): void {
    if (this.spinner) {
      this.spinner.text = message;
    }
  }

  /**
   * Mark spinner as successful
   */
  succeedSpinner(message?: string): void {
    if (this.spinner) {
      if (message) {
        this.spinner.succeed(message);
      } else {
        this.spinner.succeed();
      }
      this.spinner = null;
    }
  }

  /**
   * Mark spinner as failed
   */
  failSpinner(message?: string): void {
    if (this.spinner) {
      if (message) {
        this.spinner.fail(message);
      } else {
        this.spinner.fail();
      }
      this.spinner = null;
    }
  }

  /**
   * Stop spinner without success/fail
   */
  stopSpinner(): void {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }

  /**
   * Log success message
   */
  success(message: string): void {
    this.stopSpinner();
    console.log(chalk.green('✓'), message);
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error): void {
    this.stopSpinner();
    console.error(chalk.red('✗'), message);
    if (error && this.debugMode) {
      console.error(chalk.red(error.stack || error.message));
    }
  }

  /**
   * Log warning message
   */
  warn(message: string): void {
    this.stopSpinner();
    console.warn(chalk.yellow('⚠'), message);
  }

  /**
   * Log info message
   */
  info(message: string): void {
    this.stopSpinner();
    console.log(chalk.blue('ℹ'), message);
  }

  /**
   * Log debug message (only in debug mode)
   */
  debug(message: string, data?: any): void {
    if (this.debugMode) {
      this.stopSpinner();
      console.log(chalk.gray('[DEBUG]'), message);
      if (data) {
        console.log(chalk.gray(JSON.stringify(data, null, 2)));
      }
    }
  }

  /**
   * Log a section header
   */
  section(title: string): void {
    this.stopSpinner();
    console.log();
    console.log(chalk.bold.cyan(`▸ ${title}`));
    console.log(chalk.gray('─'.repeat(50)));
  }

  /**
   * Log a list item
   */
  listItem(message: string, indent: number = 0): void {
    const indentation = '  '.repeat(indent);
    console.log(`${indentation}${chalk.gray('•')} ${message}`);
  }

  /**
   * Log a code block
   */
  code(code: string): void {
    this.stopSpinner();
    console.log();
    console.log(chalk.gray(code));
    console.log();
  }

  /**
   * Create a blank line
   */
  newLine(): void {
    console.log();
  }

  /**
   * Clear the console
   */
  clear(): void {
    console.clear();
  }
}

// Export singleton instance
export const logger = new Logger();
