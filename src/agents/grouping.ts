/**
 * AI-powered package grouping agent
 * Uses Gemini to intelligently group related packages
 */

import { PackageInfo, PackageGroup } from '../types.js';
import { GeminiClient } from '../core/gemini-client.js';
import { logger } from '../utils/logger.js';

export class PackageGrouper {
  private gemini: GeminiClient;

  constructor(gemini: GeminiClient) {
    this.gemini = gemini;
  }

  /**
   * Group packages intelligently using Gemini AI
   */
  async groupPackages(packages: PackageInfo[]): Promise<PackageGroup[]> {
    logger.startSpinner('Analyzing package relationships with AI...');

    try {
      const prompt = this.buildGroupingPrompt(packages);
      const systemInstruction = `You are an expert in software dependency management and package ecosystems. Your task is to intelligently group npm packages that should be updated together.`;

      const response = await this.gemini.generateJSON<{
        groups: Array<{
          packages: string[];
          reasoning: string;
          priority: number;
        }>;
      }>(prompt, systemInstruction);

      // Convert to PackageGroup format
      const groups: PackageGroup[] = response.groups.map((group) => ({
        packages: packages.filter((pkg) => group.packages.includes(pkg.name)),
        reasoning: group.reasoning,
        priority: group.priority,
      }));

      // Sort by priority (higher first)
      groups.sort((a, b) => b.priority - a.priority);

      logger.succeedSpinner(`Created ${groups.length} package groups`);

      // Log groups
      logger.newLine();
      groups.forEach((group, index) => {
        logger.info(`Group ${index + 1} (Priority: ${group.priority})`);
        logger.listItem(group.reasoning, 1);
        group.packages.forEach((pkg) => {
          logger.listItem(`${pkg.name}: ${pkg.currentVersion} → ${pkg.latestVersion}`, 2);
        });
      });

      return groups;
    } catch (error) {
      logger.failSpinner('Failed to group packages with AI');
      logger.warn('Falling back to default grouping');

      // Fallback: all packages in one group
      return [
        {
          packages,
          reasoning: 'Default group (AI grouping failed)',
          priority: 1,
        },
      ];
    }
  }

  /**
   * Build the prompt for Gemini
   */
  private buildGroupingPrompt(packages: PackageInfo[]): string {
    const packageList = packages
      .map(
        (pkg) =>
          `- ${pkg.name}: ${pkg.currentVersion} → ${pkg.latestVersion}${
            pkg.homepage ? ` (${pkg.homepage})` : ''
          }`
      )
      .join('\n');

    return `
Analyze these npm packages and group them intelligently for upgrading:

${packageList}

Consider:
1. **Framework Ecosystems**: Group packages from the same framework (e.g., React, React Router, React DOM)
2. **Testing Libraries**: Group testing tools that work together (e.g., Jest, @testing-library)
3. **Build Tools**: Group build tools and their plugins (e.g., Webpack + webpack-cli)
4. **Type Dependencies**: Group type definitions with their packages (e.g., axios + @types/axios)
5. **Breaking Changes**: Separate packages with major version changes from minor/patch updates
6. **Dependencies**: Group packages that depend on each other

Guidelines:
- Create 1-5 groups (avoid too many small groups)
- Higher priority = should be updated first
- Each group should have a clear reason for being together
- If packages are unrelated, they can be in separate groups

Return a JSON object with this structure:
{
  "groups": [
    {
      "packages": ["package1", "package2"],
      "reasoning": "Clear explanation of why these packages are grouped",
      "priority": 1-10 (higher = more important)
    }
  ]
}
`;
  }

  /**
   * Simple grouping fallback (no AI)
   */
  groupSimple(packages: PackageInfo[]): PackageGroup[] {
    // Group by major version changes
    const majorUpdates = packages.filter((pkg) => {
      const current = parseInt(pkg.currentVersion.split('.')[0]);
      const latest = parseInt(pkg.latestVersion.split('.')[0]);
      return latest > current;
    });

    const minorUpdates = packages.filter((pkg) => !majorUpdates.includes(pkg));

    const groups: PackageGroup[] = [];

    if (majorUpdates.length > 0) {
      groups.push({
        packages: majorUpdates,
        reasoning: 'Major version updates (may have breaking changes)',
        priority: 2,
      });
    }

    if (minorUpdates.length > 0) {
      groups.push({
        packages: minorUpdates,
        reasoning: 'Minor/patch updates (safer)',
        priority: 1,
      });
    }

    return groups;
  }
}
