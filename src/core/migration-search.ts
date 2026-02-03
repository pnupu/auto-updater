/**
 * Migration guide search - find and extract migration documentation
 *
 * Enhanced to search multiple sources:
 * - GitHub releases and changelogs
 * - NPM registry metadata
 * - Known migration docs for popular packages
 * - Package READMEs
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger.js';
import { PackageInfo } from '../types.js';

export interface MigrationGuide {
  source: string;
  url: string;
  content: string;
  relevance: number;
}

interface NpmRegistryData {
  repository?: {
    type?: string;
    url?: string;
    directory?: string;
  };
  homepage?: string;
  bugs?: {
    url?: string;
  };
}

// Max content size per migration doc (100KB) - Gemini 3 has 1M token context
// so we can be generous, but still want to avoid fetching huge files
const MAX_CONTENT_SIZE = 100_000;

// Known migration documentation URLs for popular packages
const KNOWN_MIGRATION_DOCS: Record<string, (version: string) => string[]> = {
  'react': (v) => [
    'https://react.dev/blog/2022/03/08/react-18-upgrade-guide',
    `https://github.com/facebook/react/releases/tag/v${v}`,
  ],
  'react-dom': (v) => [
    'https://react.dev/blog/2022/03/08/react-18-upgrade-guide',
    `https://github.com/facebook/react/releases/tag/v${v}`,
  ],
  'typescript': (v) => [
    `https://www.typescriptlang.org/docs/handbook/release-notes/typescript-${v.split('.').slice(0, 2).join('-')}.html`,
    `https://github.com/microsoft/TypeScript/releases/tag/v${v}`,
  ],
  'jest': (v) => [
    `https://jestjs.io/docs/upgrading-to-jest${v.split('.')[0]}`,
    `https://github.com/jestjs/jest/releases/tag/v${v}`,
  ],
  'webpack': (v) => [
    `https://webpack.js.org/migrate/${v.split('.')[0]}/`,
    `https://github.com/webpack/webpack/releases/tag/v${v}`,
  ],
  'eslint': (v) => [
    `https://eslint.org/docs/latest/use/migrate-to-${v.split('.')[0]}.0.0`,
    `https://github.com/eslint/eslint/releases/tag/v${v}`,
  ],
  'next': (v) => [
    `https://nextjs.org/docs/pages/building-your-application/upgrading/version-${v.split('.')[0]}`,
    `https://github.com/vercel/next.js/releases/tag/v${v}`,
  ],
  'vue': (v) => [
    'https://v3-migration.vuejs.org/',
    `https://github.com/vuejs/core/releases/tag/v${v}`,
  ],
  'angular': (v) => [
    `https://angular.io/guide/updating-to-version-${v.split('.')[0]}`,
  ],
  '@angular/core': (v) => [
    `https://angular.io/guide/updating-to-version-${v.split('.')[0]}`,
  ],
  'chalk': (v) => [
    `https://github.com/chalk/chalk/releases/tag/v${v}`,
    'https://github.com/chalk/chalk#install',
  ],
  'commander': (v) => [
    `https://github.com/tj/commander.js/releases/tag/v${v}`,
    'https://github.com/tj/commander.js/blob/master/CHANGELOG.md',
  ],
  'express': (v) => [
    `https://github.com/expressjs/express/releases/tag/${v}`,
    'https://expressjs.com/en/guide/migrating-5.html',
  ],
  'lodash': (v) => [
    `https://github.com/lodash/lodash/releases/tag/${v}`,
    'https://github.com/lodash/lodash/wiki/Changelog',
  ],
  'axios': (v) => [
    `https://github.com/axios/axios/releases/tag/v${v}`,
    'https://github.com/axios/axios/blob/main/CHANGELOG.md',
  ],
  'vitest': (v) => [
    `https://github.com/vitest-dev/vitest/releases/tag/v${v}`,
    'https://vitest.dev/guide/migration.html',
  ],
};

export class MigrationSearch {
  private axiosInstance = axios.create({
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DevpostAutoUpgrader/1.0)',
      'Accept': 'application/json, text/html, */*',
    },
  });

  /** User-provided migration doc URLs (package name -> URL or URLs) */
  private userProvidedDocs: Record<string, string | string[]> = {};

  /**
   * Set user-provided migration documentation URLs
   * These will be fetched with highest priority
   */
  setUserProvidedDocs(docs: Record<string, string | string[]>): void {
    this.userProvidedDocs = docs;
    logger.debug('User-provided migration docs configured', Object.keys(docs));
  }

  /**
   * Search for migration guides for a package upgrade
   */
  async findMigrationGuides(pkg: PackageInfo): Promise<MigrationGuide[]> {
    logger.startSpinner(`Searching for migration guides for ${pkg.name}...`);

    const guides: MigrationGuide[] = [];

    try {
      // Run searches in parallel for speed
      const [
        userDocs,
        knownDocs,
        githubGuide,
        changelogGuide,
        npmGuide,
      ] = await Promise.allSettled([
        this.fetchUserProvidedDocs(pkg),
        this.checkKnownMigrationDocs(pkg),
        this.checkGitHubReleases(pkg),
        this.checkGitHubChangelog(pkg),
        this.checkNpmRegistry(pkg),
      ]);

      // Collect successful results (user docs first - highest priority)
      if (userDocs.status === 'fulfilled') {
        guides.push(...userDocs.value);
      }
      if (knownDocs.status === 'fulfilled') {
        guides.push(...knownDocs.value);
      }
      if (githubGuide.status === 'fulfilled' && githubGuide.value) {
        guides.push(githubGuide.value);
      }
      if (changelogGuide.status === 'fulfilled' && changelogGuide.value) {
        guides.push(changelogGuide.value);
      }
      if (npmGuide.status === 'fulfilled' && npmGuide.value) {
        guides.push(npmGuide.value);
      }

      // Sort by relevance
      guides.sort((a, b) => b.relevance - a.relevance);

      // Deduplicate by URL
      const uniqueGuides = guides.filter(
        (guide, index, self) => self.findIndex((g) => g.url === guide.url) === index
      );

      logger.succeedSpinner(`Found ${uniqueGuides.length} migration guide(s)`);

      return uniqueGuides.slice(0, 5); // Return top 5
    } catch (error) {
      logger.failSpinner('Failed to find migration guides');
      logger.debug('Migration search error', error);
      return [];
    }
  }

  /**
   * Fetch user-provided migration documentation URLs
   */
  private async fetchUserProvidedDocs(pkg: PackageInfo): Promise<MigrationGuide[]> {
    const guides: MigrationGuide[] = [];
    const userUrls = this.userProvidedDocs[pkg.name];

    if (!userUrls) {
      return guides;
    }

    const urls = Array.isArray(userUrls) ? userUrls : [userUrls];

    for (const url of urls) {
      try {
        logger.debug(`Fetching user-provided migration doc: ${url}`);
        const content = await this.fetchAndExtract(url);

        if (content && content.length > 50) {
          guides.push({
            source: 'User Provided',
            url,
            content, // No truncation - Gemini 3 has 1M token context
            relevance: 15, // Highest priority - user knows best
          });
          logger.debug(`Fetched ${content.length} chars from ${url}`);
        }
      } catch (error) {
        logger.warn(`Failed to fetch user-provided doc: ${url}`);
        logger.debug('Fetch error', error);
      }
    }

    return guides;
  }

  /**
   * Check known migration documentation URLs for popular packages
   */
  private async checkKnownMigrationDocs(pkg: PackageInfo): Promise<MigrationGuide[]> {
    const guides: MigrationGuide[] = [];
    const knownUrls = KNOWN_MIGRATION_DOCS[pkg.name];

    if (!knownUrls) {
      return guides;
    }

    const urls = knownUrls(pkg.latestVersion);

    for (const url of urls) {
      try {
        logger.debug(`Checking known migration doc: ${url}`);
        const content = await this.fetchAndExtract(url);

        if (content && content.length > 100) {
          guides.push({
            source: 'Official Migration Docs',
            url,
            content, // No truncation - Gemini 3 has 1M token context
            relevance: 10, // High relevance for official docs
          });
        }
      } catch (error) {
        logger.debug(`Failed to fetch known doc ${url}`, error);
      }
    }

    return guides;
  }

  /**
   * Check GitHub releases for migration information
   */
  private async checkGitHubReleases(pkg: PackageInfo): Promise<MigrationGuide | null> {
    try {
      const repoInfo = await this.getGitHubRepo(pkg);
      if (!repoInfo) return null;

      const { owner, repo } = repoInfo;

      // Try different release tag formats
      const tagFormats = [
        `v${pkg.latestVersion}`,
        pkg.latestVersion,
        `${pkg.name}@${pkg.latestVersion}`,
      ];

      for (const tag of tagFormats) {
        try {
          // Use GitHub API for releases
          const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`;
          logger.debug(`Checking GitHub API: ${apiUrl}`);

          const response = await this.axiosInstance.get(apiUrl, {
            headers: {
              'Accept': 'application/vnd.github.v3+json',
            },
          });

          if (response.status === 200 && response.data.body) {
            return {
              source: 'GitHub Releases',
              url: response.data.html_url,
              content: response.data.body,
              relevance: 9,
            };
          }
        } catch {
          // Try next format
        }
      }

      // Fall back to scraping the releases page
      const releasesUrl = `https://github.com/${owner}/${repo}/releases/tag/v${pkg.latestVersion}`;
      logger.debug(`Falling back to releases page: ${releasesUrl}`);

      const response = await this.axiosInstance.get(releasesUrl);

      if (response.status === 200) {
        const $ = cheerio.load(response.data);
        const releaseBody = $('.markdown-body').first().text();

        if (releaseBody.length > 50) {
          return {
            source: 'GitHub Releases',
            url: releasesUrl,
            content: releaseBody,
            relevance: 9,
          };
        }
      }
    } catch (error) {
      logger.debug(`Failed to check GitHub releases for ${pkg.name}`, error);
    }

    return null;
  }

  /**
   * Check GitHub for CHANGELOG.md file
   */
  private async checkGitHubChangelog(pkg: PackageInfo): Promise<MigrationGuide | null> {
    try {
      const repoInfo = await this.getGitHubRepo(pkg);
      if (!repoInfo) return null;

      const { owner, repo } = repoInfo;

      // Common changelog file names
      const changelogFiles = [
        'CHANGELOG.md',
        'HISTORY.md',
        'CHANGES.md',
        'RELEASE_NOTES.md',
        'changelog.md',
        'Changelog.md',
      ];

      for (const filename of changelogFiles) {
        try {
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${filename}`;
          logger.debug(`Checking changelog: ${rawUrl}`);

          const response = await this.axiosInstance.get(rawUrl);

          if (response.status === 200 && response.data) {
            const content = this.extractVersionSection(
              response.data,
              pkg.latestVersion,
              pkg.currentVersion
            );

            if (content && content.length > 50) {
              return {
                source: 'GitHub CHANGELOG',
                url: `https://github.com/${owner}/${repo}/blob/main/${filename}`,
                content: content,
                relevance: 8,
              };
            }
          }
        } catch {
          // Try master branch
          try {
            const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/master/${filename}`;
            const response = await this.axiosInstance.get(rawUrl);

            if (response.status === 200 && response.data) {
              const content = this.extractVersionSection(
                response.data,
                pkg.latestVersion,
                pkg.currentVersion
              );

              if (content && content.length > 50) {
                return {
                  source: 'GitHub CHANGELOG',
                  url: `https://github.com/${owner}/${repo}/blob/master/${filename}`,
                  content: content,
                  relevance: 8,
                };
              }
            }
          } catch {
            // Continue to next filename
          }
        }
      }
    } catch (error) {
      logger.debug(`Failed to check GitHub changelog for ${pkg.name}`, error);
    }

    return null;
  }

  /**
   * Check npm registry for repository and homepage info
   */
  private async checkNpmRegistry(pkg: PackageInfo): Promise<MigrationGuide | null> {
    try {
      const registryUrl = `https://registry.npmjs.org/${pkg.name}`;
      logger.debug(`Checking npm registry: ${registryUrl}`);

      const response = await this.axiosInstance.get<NpmRegistryData>(registryUrl);

      if (response.status !== 200) return null;

      const data = response.data;

      // Check homepage
      if (data.homepage) {
        try {
          const content = await this.fetchAndExtract(data.homepage);
          if (content && content.length > 100) {
            const migrationContent = this.extractMigrationContent(content);
            if (migrationContent.length > 50) {
              return {
                source: 'Package Homepage',
                url: data.homepage,
                content: migrationContent,
                relevance: 6,
              };
            }
          }
        } catch {
          // Homepage fetch failed
        }
      }
    } catch (error) {
      logger.debug(`Failed to check npm registry for ${pkg.name}`, error);
    }

    return null;
  }

  /**
   * Get GitHub repository info from package
   */
  private async getGitHubRepo(pkg: PackageInfo): Promise<{ owner: string; repo: string } | null> {
    // First check if we already have a GitHub URL
    if (pkg.homepage && pkg.homepage.includes('github.com')) {
      const match = pkg.homepage.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (match) {
        return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
      }
    }

    // Try npm registry for repository URL
    try {
      const registryUrl = `https://registry.npmjs.org/${pkg.name}`;
      const response = await this.axiosInstance.get<NpmRegistryData>(registryUrl);

      if (response.data.repository?.url) {
        const repoUrl = response.data.repository.url;
        const match = repoUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
        if (match) {
          return { owner: match[1], repo: match[2] };
        }
      }
    } catch {
      // Registry fetch failed
    }

    // Try constructing from package name
    if (pkg.name.startsWith('@')) {
      const [org, name] = pkg.name.substring(1).split('/');
      return { owner: org, repo: name };
    }

    return null;
  }

  /**
   * Fetch URL and extract main content
   */
  private async fetchAndExtract(url: string): Promise<string> {
    const response = await this.axiosInstance.get(url);

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}`);
    }

    let content: string;

    // If it's already text/markdown, use as-is
    const contentType = response.headers['content-type'] || '';
    if (contentType.includes('text/plain') || contentType.includes('text/markdown')) {
      content = response.data;
    } else {
      // Parse HTML and extract text
      const $ = cheerio.load(response.data);

      // Remove script, style, nav, footer elements
      $('script, style, nav, footer, header, aside').remove();

      // Try to find main content areas
      const mainContent = $('main, article, .content, .markdown-body, #content, .docs-content')
        .first()
        .text();

      content = (mainContent && mainContent.length > 100) ? mainContent : $('body').text();
    }

    // Apply max size limit (Gemini 3 has 1M tokens, but avoid fetching huge files)
    if (content.length > MAX_CONTENT_SIZE) {
      logger.debug(`Truncating content from ${content.length} to ${MAX_CONTENT_SIZE} chars`);
      content = content.substring(0, MAX_CONTENT_SIZE);
    }

    return content;
  }

  /**
   * Extract version-specific section from changelog
   */
  private extractVersionSection(
    changelog: string,
    targetVersion: string,
    fromVersion: string
  ): string {
    const lines = changelog.split('\n');
    const sections: string[] = [];
    let capturing = false;
    let capturedLines = 0;
    const maxLines = 150; // Limit captured content

    // Parse major versions
    const targetMajor = parseInt(targetVersion.split('.')[0], 10);
    const fromMajor = parseInt(fromVersion.split('.')[0], 10);

    for (const line of lines) {
      // Check for version headers
      const versionMatch = line.match(/^#+\s*\[?v?(\d+\.\d+(?:\.\d+)?)/i) ||
                          line.match(/^#+\s*(\d+\.\d+(?:\.\d+)?)/);

      if (versionMatch) {
        const version = versionMatch[1];
        const major = parseInt(version.split('.')[0], 10);

        // Start capturing if we hit target version or newer
        if (major <= targetMajor && major > fromMajor) {
          capturing = true;
        } else if (major <= fromMajor) {
          // Stop when we hit the current version
          break;
        }
      }

      if (capturing) {
        sections.push(line);
        capturedLines++;
        if (capturedLines >= maxLines) break;
      }
    }

    return sections.join('\n');
  }

  /**
   * Extract migration-relevant content from text
   */
  private extractMigrationContent(content: string): string {
    const lines = content.split('\n');
    const relevantLines: string[] = [];
    const keywords = [
      'breaking',
      'migration',
      'upgrade',
      'changelog',
      'deprecat',
      'removed',
      'renamed',
      'moved',
      'replac',
      'no longer',
      'instead',
      'must now',
      'required',
    ];

    let capturing = false;
    let captureCount = 0;

    for (const line of lines) {
      const lowerLine = line.toLowerCase();

      // Check for migration-related keywords
      if (keywords.some((kw) => lowerLine.includes(kw))) {
        capturing = true;
        captureCount = 0;
      }

      if (capturing) {
        relevantLines.push(line);
        captureCount++;

        // Capture up to 10 lines after a keyword match
        if (captureCount > 10) {
          capturing = false;
        }
      }
    }

    return relevantLines.join('\n');
  }

  /**
   * Extract migration-relevant content from raw text (public API)
   */
  extractRelevantContent(content: string, searchTerms: string[]): string {
    const lines = content.split('\n');
    const relevantLines: string[] = [];

    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      if (
        searchTerms.some((term) => lowerLine.includes(term.toLowerCase())) ||
        lowerLine.includes('breaking') ||
        lowerLine.includes('migration') ||
        lowerLine.includes('upgrade')
      ) {
        relevantLines.push(line);
      }
    }

    return relevantLines.join('\n');
  }
}
