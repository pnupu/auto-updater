/**
 * Fixer agent - generates and applies code fixes using Gemini AI
 */

import { Edit, FixResult, PackageInfo, TestResult } from '../types.js';
import { GeminiClient } from '../core/gemini-client.js';
import { RepoMapper } from '../core/repo-mapper.js';
import { MigrationSearch, MigrationGuide } from '../core/migration-search.js';
import { Localizer } from './localizer.js';
import { EditEngine } from '../core/edit-engine.js';
import { logger } from '../utils/logger.js';

export class CodeFixer {
  private gemini: GeminiClient;
  private repoMapper: RepoMapper;
  private migrationSearch: MigrationSearch;
  private localizer: Localizer;
  private editEngine: EditEngine;

  constructor(
    gemini: GeminiClient,
    repoMapper: RepoMapper,
    migrationSearch: MigrationSearch,
    localizer: Localizer,
    editEngine: EditEngine
  ) {
    this.gemini = gemini;
    this.repoMapper = repoMapper;
    this.migrationSearch = migrationSearch;
    this.localizer = localizer;
    this.editEngine = editEngine;
  }

  /**
   * Fix breaking changes from a package upgrade
   */
  async fixBreakingChanges(
    pkg: PackageInfo,
    testResult: TestResult,
    dryRun: boolean = false
  ): Promise<FixResult> {
    logger.section(`Fixing Breaking Changes for ${pkg.name}`);

    try {
      // 1. Find migration guides
      const migrationGuides = await this.migrationSearch.findMigrationGuides(pkg);

      // 2. Localize errors to specific files
      const affectedFiles = await this.localizer.localize(testResult, pkg.name);

      if (affectedFiles.length === 0) {
        logger.warn('Could not localize errors to specific files');
        return {
          success: false,
          edits: [],
          error: 'No files identified for fixes',
        };
      }

      // 3. Get file contents
      const filesWithContent = await Promise.all(
        affectedFiles.map(async (file) => {
          const content = await this.repoMapper['fileManager'].readFile(file);
          return { path: file, content };
        })
      );

      // 4. Generate fixes with Gemini
      logger.startSpinner('Generating fixes with AI...');

      const edits = await this.generateFixes(
        pkg,
        testResult,
        filesWithContent,
        migrationGuides
      );

      logger.succeedSpinner(`Generated ${edits.length} fix suggestions`);

      if (edits.length === 0) {
        return {
          success: false,
          edits: [],
          error: 'No fixes generated',
        };
      }

      // 5. Preview or apply edits
      if (dryRun) {
        await this.editEngine.previewEdits(edits);
        return {
          success: true,
          edits,
        };
      }

      // 6. Apply edits
      const result = await this.editEngine.applyEdits(edits);

      return {
        success: result.success,
        edits,
        error: result.failedCount > 0 ? `${result.failedCount} edits failed` : undefined,
      };
    } catch (error) {
      logger.error('Failed to fix breaking changes', error as Error);
      return {
        success: false,
        edits: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate fixes using Gemini with long context
   */
  private async generateFixes(
    pkg: PackageInfo,
    testResult: TestResult,
    files: Array<{ path: string; content: string }>,
    migrationGuides: MigrationGuide[]
  ): Promise<Edit[]> {
    const prompt = this.buildFixPrompt(pkg, testResult, files, migrationGuides);

    const systemInstruction = `You are an expert software engineer specializing in dependency upgrades and code migrations. Your task is to generate precise code fixes for breaking changes.`;

    try {
      const response = await this.gemini.generateJSON<{ edits: Edit[] }>(
        prompt,
        systemInstruction
      );

      return response.edits || [];
    } catch (error) {
      logger.error('Failed to generate fixes with Gemini', error as Error);
      return [];
    }
  }

  /**
   * Build the prompt for Gemini
   */
  private buildFixPrompt(
    pkg: PackageInfo,
    testResult: TestResult,
    files: Array<{ path: string; content: string }>,
    migrationGuides: MigrationGuide[]
  ): string {
    const filesFormatted = this.repoMapper.formatFilesForPrompt(files);

    const migrationInfo =
      migrationGuides.length > 0
        ? migrationGuides
            .map((guide) => `### ${guide.source} (${guide.url})\n${guide.content}`)
            .join('\n\n')
        : 'No migration guides found - infer from error messages.';

    const errors = this.extractRelevantErrors(testResult);

    return `
You are fixing breaking changes from upgrading ${pkg.name} from ${pkg.currentVersion} to ${pkg.latestVersion}.

## Error Output

\`\`\`
${errors}
\`\`\`

## Migration Guides

${migrationInfo}

## Affected Files

${filesFormatted}

## Task

Analyze the errors and generate precise fixes. Return a JSON object with this structure:

\`\`\`json
{
  "edits": [
    {
      "file": "path/to/file.ts",
      "description": "Brief description of the fix",
      "search": "exact code to find (must be unique in file)",
      "replace": "new code to replace it with"
    }
  ]
}
\`\`\`

## Guidelines

1. **Uniqueness**: Include enough context in 'search' to make it unique (10-20 lines)
2. **Preserve Formatting**: Match exact indentation, quotes, semicolons
3. **Complete Statements**: Don't cut off in the middle of a statement
4. **Order**: Fix imports first, then usage sites
5. **Focus**: Only fix what's broken - don't refactor unrelated code
6. **Precision**: Each search string should appear exactly once in its file

## Common Breaking Changes

- Import path changes (e.g., 'react-dom' → 'react-dom/client')
- API renames (e.g., ReactDOM.render() → createRoot().render())
- Removed/deprecated APIs
- Type signature changes
- Configuration format changes

Generate precise, surgical fixes that will pass the tests.
`;
  }

  /**
   * Extract most relevant error messages
   */
  private extractRelevantErrors(testResult: TestResult): string {
    const combined = `${testResult.stdout}\n${testResult.stderr}`;
    const lines = combined.split('\n');

    // Filter to the most relevant lines
    const relevantLines = lines.filter((line) => {
      const lower = line.toLowerCase();
      return (
        lower.includes('error') ||
        lower.includes('failed') ||
        lower.includes('cannot find') ||
        lower.includes('is not') ||
        lower.includes('expected') ||
        lower.includes('undefined')
      );
    });

    return relevantLines.slice(0, 50).join('\n');
  }
}
