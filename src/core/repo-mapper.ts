/**
 * Repository mapper - builds a compact map of the codebase
 * Inspired by Aider's repository map concept
 */

import { RepoMap, FunctionSignature, ImportInfo, FileInfo } from '../types.js';
import { FileManager } from '../utils/file.js';
import { CodeParser } from '../utils/parser.js';
import { logger } from '../utils/logger.js';

export class RepoMapper {
  private fileManager: FileManager;
  private parser: CodeParser;
  private repoMap: RepoMap | null = null;

  constructor() {
    this.fileManager = new FileManager();
    this.parser = new CodeParser();
  }

  /**
   * Build the repository map
   */
  async buildMap(): Promise<RepoMap> {
    logger.startSpinner('Building repository map...');

    try {
      const files = await this.fileManager.findSourceFiles();

      const fileInfoMap = new Map<string, FileInfo>();
      const functionMap = new Map<string, FunctionSignature[]>();
      const importMap = new Map<string, ImportInfo[]>();

      let totalFunctions = 0;
      let totalImports = 0;

      for (const filePath of files) {
        try {
          const content = await this.fileManager.readFile(filePath);

          // Store file info
          fileInfoMap.set(filePath, {
            path: filePath,
            size: content.length,
            lastModified: Date.now(),
          });

          // Parse functions
          const functions = this.parser.parseFunctions(content, filePath);
          if (functions.length > 0) {
            functionMap.set(filePath, functions);
            totalFunctions += functions.length;
          }

          // Parse imports
          const imports = this.parser.parseImports(content, filePath);
          if (imports.length > 0) {
            importMap.set(filePath, imports);
            totalImports += imports.length;
          }
        } catch (error) {
          logger.debug(`Failed to process ${filePath}`, error);
        }
      }

      this.repoMap = {
        files: fileInfoMap,
        functions: functionMap,
        imports: importMap,
      };

      logger.succeedSpinner(
        `Mapped ${files.length} files, ${totalFunctions} functions, ${totalImports} imports`
      );

      return this.repoMap;
    } catch (error) {
      logger.failSpinner('Failed to build repository map');
      throw error;
    }
  }

  /**
   * Get the repository map (build if needed)
   */
  async getMap(): Promise<RepoMap> {
    if (!this.repoMap) {
      return await this.buildMap();
    }
    return this.repoMap;
  }

  /**
   * Get context for specific files (for Gemini prompts)
   */
  async getContextForFiles(filePaths: string[]): Promise<string> {
    const map = await this.getMap();
    const context: string[] = [];

    for (const filePath of filePaths) {
      const functions = map.functions.get(filePath) || [];
      const imports = map.imports.get(filePath) || [];

      context.push(`\n## ${filePath}`);

      if (imports.length > 0) {
        context.push('\nImports:');
        imports.forEach((imp) => {
          context.push(`- from '${imp.from}': ${imp.imports.join(', ')}`);
        });
      }

      if (functions.length > 0) {
        context.push('\nFunctions:');
        functions.forEach((func) => {
          const params = func.params.join(', ');
          context.push(`- ${func.name}(${params}) [line ${func.startLine}-${func.endLine}]`);
        });
      }
    }

    return context.join('\n');
  }

  /**
   * Get full codebase context (all files)
   */
  async getFullContext(): Promise<string> {
    const map = await this.getMap();
    return await this.getContextForFiles(Array.from(map.files.keys()));
  }

  /**
   * Get compact codebase summary (for efficient Gemini context)
   */
  async getCompactSummary(): Promise<string> {
    const map = await this.getMap();
    const summary: string[] = [];

    summary.push('# Codebase Structure\n');

    // Group files by directory
    const filesByDir = new Map<string, string[]>();
    for (const filePath of map.files.keys()) {
      const dir = filePath.split('/').slice(0, -1).join('/') || '.';
      if (!filesByDir.has(dir)) {
        filesByDir.set(dir, []);
      }
      filesByDir.get(dir)!.push(filePath);
    }

    // Summarize each directory
    for (const [dir, files] of filesByDir.entries()) {
      summary.push(`\n## ${dir}/`);
      for (const file of files) {
        const functions = map.functions.get(file) || [];
        const functionNames = functions.map((f) => f.name).slice(0, 5); // Top 5 functions
        if (functionNames.length > 0) {
          summary.push(`- ${file}: ${functionNames.join(', ')}`);
        } else {
          summary.push(`- ${file}`);
        }
      }
    }

    return summary.join('\n');
  }

  /**
   * Find files that import a specific package
   */
  async findFilesImporting(packageName: string): Promise<string[]> {
    const map = await this.getMap();
    const files: string[] = [];

    for (const [filePath, imports] of map.imports.entries()) {
      for (const imp of imports) {
        if (imp.from === packageName || imp.from.startsWith(`${packageName}/`)) {
          files.push(filePath);
          break;
        }
      }
    }

    return files;
  }

  /**
   * Get all files with full content for Gemini's long context
   */
  async getAllFilesWithContent(): Promise<Array<{ path: string; content: string }>> {
    const map = await this.getMap();
    const filesWithContent: Array<{ path: string; content: string }> = [];

    for (const filePath of map.files.keys()) {
      try {
        const content = await this.fileManager.readFile(filePath);
        filesWithContent.push({ path: filePath, content });
      } catch (error) {
        logger.debug(`Failed to read ${filePath}`, error);
      }
    }

    return filesWithContent;
  }

  /**
   * Format files for Gemini prompt (with line numbers)
   */
  formatFilesForPrompt(files: Array<{ path: string; content: string }>): string {
    const formatted: string[] = [];

    for (const { path, content } of files) {
      formatted.push(`\n## File: ${path}`);
      formatted.push('```');

      // Add line numbers
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        formatted.push(`${(index + 1).toString().padStart(4, ' ')} | ${line}`);
      });

      formatted.push('```');
    }

    return formatted.join('\n');
  }
}
