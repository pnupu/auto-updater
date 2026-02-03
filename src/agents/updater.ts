/**
 * Package updater - modifies package.json and runs npm install
 */

import { readFile, writeFile } from 'fs/promises';
import { execa } from 'execa';
import { PackageInfo } from '../types.js';
import { logger } from '../utils/logger.js';

export class PackageUpdater {
  private originalPackageJson: string | null = null;

  /**
   * Update packages in package.json
   */
  async updatePackages(packages: PackageInfo[]): Promise<void> {
    logger.startSpinner(`Updating ${packages.length} package(s) in package.json...`);

    try {
      // Backup original package.json
      this.originalPackageJson = await readFile('package.json', 'utf-8');
      const packageJson = JSON.parse(this.originalPackageJson);

      // Update versions
      for (const pkg of packages) {
        if (packageJson.dependencies?.[pkg.name]) {
          packageJson.dependencies[pkg.name] = `^${pkg.latestVersion}`;
        }
        if (packageJson.devDependencies?.[pkg.name]) {
          packageJson.devDependencies[pkg.name] = `^${pkg.latestVersion}`;
        }
      }

      // Write updated package.json
      await writeFile('package.json', JSON.stringify(packageJson, null, 2) + '\n');

      logger.updateSpinner('Running npm install...');

      // Run npm install
      await execa('npm', ['install'], {
        stdio: 'pipe',
      });

      logger.succeedSpinner('Packages updated successfully');
    } catch (error) {
      logger.failSpinner('Failed to update packages');
      // Restore original package.json on error
      if (this.originalPackageJson) {
        await this.rollback();
      }
      throw error;
    }
  }

  /**
   * Rollback to original package.json
   */
  async rollback(): Promise<void> {
    if (!this.originalPackageJson) {
      logger.warn('No backup found for rollback');
      return;
    }

    logger.startSpinner('Rolling back package.json...');

    try {
      await writeFile('package.json', this.originalPackageJson);

      // Run npm install to restore node_modules
      await execa('npm', ['install'], {
        stdio: 'pipe',
      });

      logger.succeedSpinner('Rollback complete');
      this.originalPackageJson = null;
    } catch (error) {
      logger.failSpinner('Failed to rollback');
      throw error;
    }
  }

  /**
   * Check if node_modules exists
   */
  async hasNodeModules(): Promise<boolean> {
    try {
      const { existsSync } = await import('fs');
      return existsSync('node_modules');
    } catch {
      return false;
    }
  }

  /**
   * Get installed version of a package
   */
  async getInstalledVersion(packageName: string): Promise<string | null> {
    try {
      const result = await execa('npm', ['list', packageName, '--depth=0', '--json'], {
        reject: false,
      });

      if (result.stdout) {
        const info = JSON.parse(result.stdout);
        return info.dependencies?.[packageName]?.version || null;
      }
    } catch (error) {
      logger.debug(`Failed to get installed version for ${packageName}`, error);
    }

    return null;
  }

  /**
   * Clear the backup (after successful commit)
   */
  clearBackup(): void {
    this.originalPackageJson = null;
  }
}
