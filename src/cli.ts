#!/usr/bin/env node

/**
 * CLI entry point for devpost-autoupgrader
 *
 * Uses LangGraph for state machine orchestration - enabling pause/resume
 * and making this a true "Marathon Agent" for the hackathon.
 */

import { config } from 'dotenv';
import { Command } from 'commander';

// Load environment variables from .env file
// Try current directory and parent directories
config();
config({ path: '../.env' });
config({ path: '../../.env' });

import { logger } from './utils/logger.js';
import { createGeminiClient } from './core/gemini-client.js';
import { Config } from './types.js';
import { runWorkflow, createFileCheckpointer } from './core/workflow.js';
import fs from 'fs/promises';
import path from 'path';

const program = new Command();

const STATE_FILE = '.devpost-upgrade-state.json';
const THREAD_ID = 'devpost-upgrade-main';

/**
 * Collect multiple --migration-doc flags into an object
 */
function collectMigrationDocs(
  value: string,
  previous: Record<string, string | string[]>
): Record<string, string | string[]> {
  const [pkg, url] = value.split('=');
  if (!pkg || !url) {
    logger.warn(`Invalid migration-doc format: ${value}. Use: --migration-doc react=https://...`);
    return previous;
  }

  // Support multiple URLs per package
  if (previous[pkg]) {
    const existing = previous[pkg];
    previous[pkg] = Array.isArray(existing) ? [...existing, url] : [existing, url];
  } else {
    previous[pkg] = url;
  }

  return previous;
}

/**
 * Check if saved state exists
 */
async function hasSavedState(): Promise<boolean> {
  try {
    await fs.access(STATE_FILE);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete saved state
 */
async function clearSavedState(): Promise<void> {
  try {
    await fs.unlink(STATE_FILE);
  } catch {
    // File didn't exist
  }
}

program
  .name('devpost-upgrade')
  .description('AI-powered dependency upgrade tool that automatically handles breaking changes')
  .version('1.0.0')
  .option('--dry-run', 'Preview changes without applying them')
  .option('--interactive', 'Ask for confirmation before each step')
  .option('--no-commit', 'Skip creating git commits')
  .option('--group <packages>', 'Manually specify packages to group together (comma-separated)')
  .option('--build-command <cmd>', 'Custom build command (default: npm run build)')
  .option('--test-command <cmd>', 'Custom test command (default: npm test)')
  .option('--max-retries <n>', 'Maximum retry attempts for fixes (default: 3)', parseInt)
  .option('--migration-doc <pkg=url>', 'Provide migration doc URL for a package (can be used multiple times)', collectMigrationDocs, {})
  .option('--resume', 'Resume from a previously interrupted upgrade')
  .option('--clear-state', 'Clear saved state and start fresh')
  .action(async (options) => {
    try {
      logger.clear();
      logger.section('Devpost Auto-Upgrader');
      logger.info('AI-powered dependency management with automatic breaking change fixes');
      logger.info('Powered by LangGraph state machine');
      logger.newLine();

      // Handle --clear-state
      if (options.clearState) {
        await clearSavedState();
        logger.success('Saved state cleared');
        return;
      }

      // Check for existing state
      const hasState = await hasSavedState();
      const checkpointer = createFileCheckpointer();

      if (hasState && !options.resume) {
        logger.warn('Found saved state from a previous run');
        const summary = await checkpointer.getStateSummary();
        if (summary) {
          logger.info(`  ${summary}`);
        }
        logger.newLine();
        logger.info('Options:');
        logger.info('  --resume       Continue from where you left off');
        logger.info('  --clear-state  Delete saved state and start fresh');
        logger.newLine();
        return;
      }

      if (options.resume && !hasState) {
        logger.error('No saved state found to resume from');
        logger.info('Run without --resume to start a new upgrade');
        return;
      }

      // Load configuration (only for fresh runs)
      let configObj: Config;
      if (options.resume) {
        // For resume, we'll use the config from the saved state
        // The checkpointer will restore it
        configObj = await loadConfig(options);
        logger.info('Resuming interrupted upgrade...');
      } else {
        configObj = await loadConfig(options);
        logger.debug('Configuration loaded', configObj);
      }

      // Verify Gemini API key (optional for basic workflow)
      try {
        createGeminiClient();
        logger.success('Gemini API connection verified');
      } catch {
        logger.warn('Gemini API not configured - AI features disabled');
        logger.info('Get your API key from: https://aistudio.google.com/app/apikey');
        logger.info('Then set it with: export GEMINI_API_KEY="your_key"');
        logger.newLine();
      }

      // Verify we're in a valid npm project
      try {
        await fs.access('package.json');
        logger.success('Found package.json');
      } catch {
        logger.error('No package.json found in current directory');
        logger.info('Please run this command from the root of your npm project');
        process.exit(1);
      }

      // Run the LangGraph workflow
      const result = await runWorkflow(configObj, {
        checkpointer,
        threadId: THREAD_ID,
        resume: options.resume,
      });

      // Clear state on successful completion
      if (result.success) {
        await clearSavedState();
      }

      if (!result.success) {
        logger.newLine();
        logger.info('Your progress has been saved. Run with --resume to continue.');
        process.exit(1);
      }

    } catch (error) {
      logger.error('Fatal error', error as Error);
      logger.newLine();
      logger.info('Your progress may have been saved. Run with --resume to continue.');
      process.exit(1);
    }
  });

/**
 * Load configuration from file and CLI options
 */
async function loadConfig(options: any): Promise<Config> {
  // Default configuration
  let config: Config = {
    buildCommand: 'npm run build',
    testCommand: 'npm test',
    maxRetries: 3,
    createCommits: true,
    geminiModel: 'gemini-3-pro-preview',
    dryRun: false,
    interactive: false,
    migrationDocs: {},
  };

  // Try to load from .devpost-upgrader.json
  try {
    const configPath = path.join(process.cwd(), '.devpost-upgrader.json');
    const configFile = await fs.readFile(configPath, 'utf-8');
    const fileConfig = JSON.parse(configFile);
    config = { ...config, ...fileConfig };
    logger.debug('Loaded configuration from .devpost-upgrader.json');
  } catch {
    // No config file, use defaults
    logger.debug('No .devpost-upgrader.json found, using defaults');
  }

  // Override with CLI options
  if (options.dryRun) config.dryRun = true;
  if (options.interactive) config.interactive = true;
  if (options.commit === false) config.createCommits = false;
  if (options.buildCommand) config.buildCommand = options.buildCommand;
  if (options.testCommand) config.testCommand = options.testCommand;
  if (options.maxRetries) config.maxRetries = options.maxRetries;

  // Merge CLI migration docs with config file ones (CLI takes precedence)
  if (options.migrationDoc && Object.keys(options.migrationDoc).length > 0) {
    config.migrationDocs = { ...config.migrationDocs, ...options.migrationDoc };
  }

  return config;
}

// Parse arguments
program.parse();
