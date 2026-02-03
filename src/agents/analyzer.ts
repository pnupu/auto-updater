/**
 * Package analyzer - finds outdated dependencies using npm-check-updates
 */

import { execa } from 'execa';
import { readFile } from 'fs/promises';
import { PackageInfo } from '../types.js';
import { logger } from '../utils/logger.js';
import semver from 'semver';

export class PackageAnalyzer {
  /**
   * Analyze package.json to find outdated dependencies
   */
  async analyze(): Promise<PackageInfo[]> {
    logger.startSpinner('Analyzing dependencies...');

    try {
      // Read current package.json
      const packageJsonContent = await readFile('package.json', 'utf-8');
      const packageJson = JSON.parse(packageJsonContent);

      // Run npm-check-updates to get available updates
      const result = await execa('npx', ['npm-check-updates', '--jsonUpgraded'], {
        reject: false,
      });

      if (result.exitCode !== 0 && !result.stdout) {
        throw new Error('Failed to run npm-check-updates');
      }

      const updates = result.stdout ? JSON.parse(result.stdout) : {};

      // Convert to PackageInfo array
      const packages: PackageInfo[] = [];

      for (const [name, latestVersion] of Object.entries(updates)) {
        const currentVersion =
          packageJson.dependencies?.[name] ||
          packageJson.devDependencies?.[name] ||
          'unknown';

        packages.push({
          name,
          currentVersion: this.cleanVersion(currentVersion),
          latestVersion: this.cleanVersion(latestVersion as string),
        });
      }

      logger.succeedSpinner(`Found ${packages.length} outdated packages`);

      // Log packages
      if (packages.length > 0) {
        logger.newLine();
        packages.forEach((pkg) => {
          const change = this.getVersionChange(pkg.currentVersion, pkg.latestVersion);
          const emoji = change === 'major' ? '🔴' : change === 'minor' ? '🟡' : '🟢';
          logger.listItem(
            `${emoji} ${pkg.name}: ${pkg.currentVersion} → ${pkg.latestVersion} (${change})`,
            1
          );
        });
      } else {
        logger.info('All dependencies are up to date! 🎉');
      }

      return packages;
    } catch (error) {
      logger.failSpinner('Failed to analyze dependencies');
      throw error;
    }
  }

  /**
   * Get detailed information about a package
   */
  async getPackageDetails(packageName: string): Promise<Partial<PackageInfo>> {
    try {
      // Fetch package info from npm registry
      const result = await execa('npm', ['view', packageName, 'homepage', 'repository.url', '--json'], {
        reject: false,
      });

      if (result.stdout) {
        const info = JSON.parse(result.stdout);
        return {
          homepage: info.homepage || info['repository.url'],
        };
      }
    } catch (error) {
      logger.debug(`Failed to get details for ${packageName}`, error);
    }

    return {};
  }

  /**
   * Fetch changelog/release notes for a package
   */
  async getChangelog(packageName: string, version: string): Promise<string | undefined> {
    try {
      // Try to get changelog from npm
      const result = await execa('npm', ['view', `${packageName}@${version}`, 'readme'], {
        reject: false,
      });

      if (result.stdout) {
        // Look for changelog section in readme
        const changelogMatch = result.stdout.match(/#+\s*(?:Changelog|Changes|Release Notes)([\s\S]*?)(?=\n#+|$)/i);
        if (changelogMatch) {
          return changelogMatch[1].trim().substring(0, 500); // First 500 chars
        }
      }
    } catch (error) {
      logger.debug(`Failed to get changelog for ${packageName}@${version}`, error);
    }

    return undefined;
  }

  /**
   * Determine the type of version change
   */
  private getVersionChange(current: string, latest: string): 'major' | 'minor' | 'patch' | 'unknown' {
    try {
      const currentClean = semver.coerce(current);
      const latestClean = semver.coerce(latest);

      if (!currentClean || !latestClean) {
        return 'unknown';
      }

      if (semver.major(latestClean) > semver.major(currentClean)) {
        return 'major';
      } else if (semver.minor(latestClean) > semver.minor(currentClean)) {
        return 'minor';
      } else {
        return 'patch';
      }
    } catch {
      return 'unknown';
    }
  }

  /**
   * Clean version string (remove ^, ~, etc.)
   */
  private cleanVersion(version: string): string {
    return version.replace(/^[\^~>=<]/, '');
  }
}
