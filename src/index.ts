/**
 * Main entry point for programmatic usage
 */

export { GeminiClient, createGeminiClient, type GeminiConfig } from './core/gemini-client.js';
export { RepoMapper } from './core/repo-mapper.js';
export { EditEngine } from './core/edit-engine.js';
export { MigrationSearch, type MigrationGuide } from './core/migration-search.js';

export { logger } from './utils/logger.js';
export { GitManager } from './utils/git.js';
export { FileManager } from './utils/file.js';
export { CodeParser } from './utils/parser.js';

export { PackageAnalyzer } from './agents/analyzer.js';
export { PackageGrouper } from './agents/grouping.js';
export { PackageUpdater } from './agents/updater.js';
export { TestRunner } from './agents/tester.js';
export { CodeFixer } from './agents/fixer.js';
export { Localizer } from './agents/localizer.js';

export * from './types.js';
