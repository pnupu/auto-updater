/**
 * Code parser for extracting function signatures and imports
 */

import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { FunctionSignature, ImportInfo } from '../types.js';
import { logger } from './logger.js';

/**
 * Helper function to get class name from a path
 */
function getClassName(path: any): string | null {
  let parent = path.parentPath;
  while (parent) {
    if (parent.node.type === 'ClassDeclaration' && parent.node.id) {
      return parent.node.id.name;
    }
    parent = parent.parentPath;
  }
  return null;
}

export class CodeParser {
  /**
   * Parse a file and extract function signatures
   */
  parseFunctions(content: string, filePath: string): FunctionSignature[] {
    const functions: FunctionSignature[] = [];

    try {
      const ast = parse(content, {
        sourceType: 'module',
        plugins: [
          'typescript',
          'jsx',
          'decorators-legacy',
          'classProperties',
          'objectRestSpread',
        ],
      });

      traverse(ast, {
        FunctionDeclaration(path) {
          const node = path.node;
          if (node.id) {
            functions.push({
              name: node.id.name,
              file: filePath,
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              params: node.params.map((p) => {
                if (p.type === 'Identifier') {
                  return p.name;
                }
                return 'param';
              }),
              returnType: node.returnType ? 'typed' : undefined,
            });
          }
        },
        ArrowFunctionExpression(path) {
          const parent = path.parent;
          if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
            functions.push({
              name: parent.id.name,
              file: filePath,
              startLine: path.node.loc?.start.line || 0,
              endLine: path.node.loc?.end.line || 0,
              params: path.node.params.map((p) => {
                if (p.type === 'Identifier') {
                  return p.name;
                }
                return 'param';
              }),
              returnType: path.node.returnType ? 'typed' : undefined,
            });
          }
        },
        ClassMethod: (path) => {
          const node = path.node;
          if (node.key.type === 'Identifier') {
            const className = getClassName(path);
            functions.push({
              name: className ? `${className}.${node.key.name}` : node.key.name,
              file: filePath,
              startLine: node.loc?.start.line || 0,
              endLine: node.loc?.end.line || 0,
              params: node.params.map((p) => {
                if (p.type === 'Identifier') {
                  return p.name;
                }
                return 'param';
              }),
              returnType: node.returnType ? 'typed' : undefined,
            });
          }
        },
      });
    } catch (error) {
      logger.debug(`Failed to parse ${filePath}`, error);
    }

    return functions;
  }

  /**
   * Parse imports from a file
   */
  parseImports(content: string, filePath: string): ImportInfo[] {
    const imports: ImportInfo[] = [];

    try {
      const ast = parse(content, {
        sourceType: 'module',
        plugins: [
          'typescript',
          'jsx',
          'decorators-legacy',
          'classProperties',
          'objectRestSpread',
        ],
      });

      traverse(ast, {
        ImportDeclaration(path) {
          const node = path.node;
          const importNames: string[] = [];

          for (const specifier of node.specifiers) {
            if (specifier.type === 'ImportDefaultSpecifier') {
              importNames.push(specifier.local.name);
            } else if (specifier.type === 'ImportSpecifier') {
              importNames.push(specifier.local.name);
            } else if (specifier.type === 'ImportNamespaceSpecifier') {
              importNames.push(specifier.local.name);
            }
          }

          imports.push({
            from: node.source.value,
            imports: importNames,
            file: filePath,
          });
        },
      });
    } catch (error) {
      logger.debug(`Failed to parse imports from ${filePath}`, error);
    }

    return imports;
  }

  /**
   * Extract a summary of the file (first few lines, exports, etc.)
   */
  summarizeFile(content: string, maxLines: number = 10): string {
    const lines = content.split('\n');
    const summary = lines.slice(0, maxLines).join('\n');

    // Also try to extract JSDoc comments or header comments
    const headerComment = this.extractHeaderComment(content);

    if (headerComment) {
      return `${headerComment}\n\n${summary}`;
    }

    return summary;
  }

  /**
   * Extract header comment from file
   */
  private extractHeaderComment(content: string): string | null {
    // Match block comments at the start of file
    const match = content.match(/^\/\*\*([\s\S]*?)\*\//);
    if (match) {
      return match[0];
    }

    // Match multiple line comments at start
    const lineCommentMatch = content.match(/^(\/\/.*\n)+/);
    if (lineCommentMatch) {
      return lineCommentMatch[0];
    }

    return null;
  }
}
