/**
 * Core types and interfaces for the devpost-autoupgrader
 */

export interface PackageInfo {
  name: string;
  currentVersion: string;
  latestVersion: string;
  changelog?: string;
  homepage?: string;
}

export interface PackageGroup {
  packages: PackageInfo[];
  reasoning: string;
  priority: number;
}

export interface TestResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface Edit {
  file: string;
  description: string;
  search: string;
  replace: string;
}

export interface FixResult {
  success: boolean;
  edits: Edit[];
  error?: string;
}

export interface UpgradeState {
  packages: PackageInfo[];
  groups: PackageGroup[];
  currentGroup?: PackageGroup;
  testsPassed: boolean;
  retryCount: number;
  errors: string[];
  completedGroups: PackageGroup[];
}

export interface Config {
  buildCommand: string;
  testCommand: string;
  maxRetries: number;
  createCommits: boolean;
  geminiModel: string;
  dryRun: boolean;
  interactive: boolean;
  /** User-provided migration doc URLs (package name -> URL or URLs) */
  migrationDocs?: Record<string, string | string[]>;
}

export interface RepoMap {
  files: Map<string, FileInfo>;
  functions: Map<string, FunctionSignature[]>;
  imports: Map<string, ImportInfo[]>;
}

export interface FileInfo {
  path: string;
  size: number;
  lastModified: number;
}

export interface FunctionSignature {
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  params: string[];
  returnType?: string;
}

export interface ImportInfo {
  from: string;
  imports: string[];
  file: string;
}

export enum WorkflowState {
  ANALYZE = 'analyze',
  GROUP = 'group',
  UPDATE = 'update',
  REPRODUCE = 'reproduce',
  LOCALIZE = 'localize',
  FIX = 'fix',
  VALIDATE = 'validate',
  COMMIT = 'commit',
  COMPLETE = 'complete',
}
