/**
 * LangGraph-based workflow for dependency upgrades
 *
 * This implements a state machine that can be paused, resumed, and persisted.
 * Perfect for the "Marathon Agent" track - autonomous long-running tasks.
 */

import { StateGraph, Annotation, END, START } from '@langchain/langgraph';
import { BaseCheckpointSaver, MemorySaver } from '@langchain/langgraph';
import { PackageInfo, PackageGroup, TestResult, Config, WorkflowState } from '../types.js';
import { logger } from '../utils/logger.js';
import { PackageAnalyzer } from '../agents/analyzer.js';
import { PackageGrouper } from '../agents/grouping.js';
import { PackageUpdater } from '../agents/updater.js';
import { TestRunner } from '../agents/tester.js';
import { CodeFixer } from '../agents/fixer.js';
import { Localizer } from '../agents/localizer.js';
import { GitManager } from '../utils/git.js';
import { GeminiClient, createGeminiClient } from './gemini-client.js';
import { RepoMapper } from './repo-mapper.js';
import { MigrationSearch } from './migration-search.js';
import { EditEngine } from './edit-engine.js';

/**
 * Workflow state annotation - defines all state that flows through the graph
 */
const WorkflowStateAnnotation = Annotation.Root({
  // Configuration
  config: Annotation<Config>,

  // Workflow phase
  phase: Annotation<WorkflowState>({
    default: () => WorkflowState.ANALYZE,
    reducer: (_, next) => next,
  }),

  // Package data
  packages: Annotation<PackageInfo[]>({
    default: () => [],
    reducer: (_, next) => next,
  }),
  groups: Annotation<PackageGroup[]>({
    default: () => [],
    reducer: (_, next) => next,
  }),

  // Current processing state
  currentGroupIndex: Annotation<number>({
    default: () => 0,
    reducer: (_, next) => next,
  }),

  // Test results
  testResult: Annotation<{ build: TestResult; test: TestResult; success: boolean } | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),

  // Fix attempts
  fixAttempts: Annotation<number>({
    default: () => 0,
    reducer: (_, next) => next,
  }),

  // Completed groups
  completedGroups: Annotation<number[]>({
    default: () => [],
    reducer: (prev, next) => [...prev, ...next],
  }),

  // Error tracking
  error: Annotation<string | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),

  // Flags
  isGitRepo: Annotation<boolean>({
    default: () => false,
    reducer: (_, next) => next,
  }),
  aiEnabled: Annotation<boolean>({
    default: () => false,
    reducer: (_, next) => next,
  }),
});

type GraphState = typeof WorkflowStateAnnotation.State;

/**
 * Shared components (initialized once, reused across nodes)
 */
interface WorkflowComponents {
  analyzer: PackageAnalyzer;
  grouper: PackageGrouper | null;
  updater: PackageUpdater;
  tester: TestRunner;
  fixer: CodeFixer | null;
  git: GitManager;
  gemini: GeminiClient | null;
  repoMapper: RepoMapper;
  migrationSearch: MigrationSearch;
  editEngine: EditEngine;
  localizer: Localizer;
}

let components: WorkflowComponents | null = null;

/**
 * Initialize shared components
 */
function initComponents(config: Config): WorkflowComponents {
  if (components) return components;

  const git = new GitManager();
  const repoMapper = new RepoMapper();
  const migrationSearch = new MigrationSearch();
  const editEngine = new EditEngine(git);
  const localizer = new Localizer(repoMapper);

  // Configure user-provided migration docs
  if (config.migrationDocs && Object.keys(config.migrationDocs).length > 0) {
    migrationSearch.setUserProvidedDocs(config.migrationDocs);
  }

  let gemini: GeminiClient | null = null;
  let grouper: PackageGrouper | null = null;
  let fixer: CodeFixer | null = null;

  try {
    gemini = createGeminiClient();
    grouper = new PackageGrouper(gemini);
    fixer = new CodeFixer(gemini, repoMapper, migrationSearch, localizer, editEngine);
  } catch {
    logger.debug('Gemini not available - AI features disabled');
  }

  components = {
    analyzer: new PackageAnalyzer(),
    grouper,
    updater: new PackageUpdater(),
    tester: new TestRunner(),
    fixer,
    git,
    gemini,
    repoMapper,
    migrationSearch,
    editEngine,
    localizer,
  };

  return components;
}

/**
 * Reset components (for testing)
 */
export function resetComponents(): void {
  components = null;
}

// ============================================================================
// GRAPH NODES
// ============================================================================

/**
 * ANALYZE node - Find outdated packages
 */
async function analyzeNode(state: GraphState): Promise<Partial<GraphState>> {
  logger.section('Phase 1: Analysis');

  const { analyzer, git } = initComponents(state.config);

  // Check git status
  const isGitRepo = await git.isGitRepo();
  if (isGitRepo) {
    await git.warnUncommittedChanges();
  } else {
    logger.warn('Not a git repository - commits will be skipped');
  }

  // Analyze packages
  const packages = await analyzer.analyze();

  if (packages.length === 0) {
    logger.info('Nothing to upgrade!');
    return {
      packages: [],
      phase: WorkflowState.COMPLETE,
      isGitRepo,
      aiEnabled: !!initComponents(state.config).gemini,
    };
  }

  return {
    packages,
    phase: WorkflowState.GROUP,
    isGitRepo,
    aiEnabled: !!initComponents(state.config).gemini,
  };
}

/**
 * GROUP node - AI-powered package grouping
 */
async function groupNode(state: GraphState): Promise<Partial<GraphState>> {
  logger.section('Phase 2: Intelligent Grouping');

  const { grouper } = initComponents(state.config);

  let groups: PackageGroup[];

  if (grouper && state.aiEnabled) {
    groups = await grouper.groupPackages(state.packages);
  } else {
    logger.warn('AI grouping not available - using simple grouping');
    // Simple grouping: one package per group
    groups = state.packages.map((pkg, i) => ({
      packages: [pkg],
      reasoning: `Update ${pkg.name}`,
      priority: 10 - i,
    }));
  }

  // Handle dry run
  if (state.config.dryRun) {
    logger.section('Dry Run - Preview');
    logger.info('Would process the following groups:');
    groups.forEach((group, i) => {
      logger.newLine();
      logger.info(`Group ${i + 1}:`);
      logger.listItem(group.reasoning, 1);
      group.packages.forEach((pkg) => {
        logger.listItem(`${pkg.name}: ${pkg.currentVersion} → ${pkg.latestVersion}`, 2);
      });
    });
    return { groups, phase: WorkflowState.COMPLETE };
  }

  return {
    groups,
    currentGroupIndex: 0,
    phase: WorkflowState.UPDATE,
  };
}

/**
 * UPDATE node - Update packages in current group
 */
async function updateNode(state: GraphState): Promise<Partial<GraphState>> {
  const group = state.groups[state.currentGroupIndex];
  const totalGroups = state.groups.length;

  logger.section(`Phase 3: Processing Group ${state.currentGroupIndex + 1}/${totalGroups}`);
  logger.info(group.reasoning);
  logger.newLine();

  const { updater } = initComponents(state.config);

  try {
    await updater.updatePackages(group.packages);
    return { phase: WorkflowState.REPRODUCE, fixAttempts: 0 };
  } catch (error) {
    return {
      error: `Failed to update packages: ${error}`,
      phase: WorkflowState.COMPLETE,
    };
  }
}

/**
 * REPRODUCE node - Run tests to check for breaking changes
 */
async function reproduceNode(state: GraphState): Promise<Partial<GraphState>> {
  logger.newLine();

  const { tester } = initComponents(state.config);
  const results = await tester.runAll(state.config.buildCommand, state.config.testCommand);

  if (results.success) {
    return {
      testResult: results,
      phase: WorkflowState.COMMIT,
    };
  }

  logger.warn('Tests failed - attempting AI-powered fixes...');

  return {
    testResult: results,
    phase: WorkflowState.LOCALIZE,
  };
}

/**
 * LOCALIZE node - Find files that need fixing
 */
async function localizeNode(state: GraphState): Promise<Partial<GraphState>> {
  // If no AI or max retries reached, go to rollback
  if (!state.aiEnabled || state.fixAttempts >= state.config.maxRetries) {
    return { phase: WorkflowState.COMPLETE, error: 'Unable to fix breaking changes' };
  }

  return { phase: WorkflowState.FIX };
}

/**
 * FIX node - AI-powered code fixing
 */
async function fixNode(state: GraphState): Promise<Partial<GraphState>> {
  const { fixer } = initComponents(state.config);

  if (!fixer || !state.testResult) {
    return {
      error: 'AI fixing not available',
      phase: WorkflowState.COMPLETE,
    };
  }

  const group = state.groups[state.currentGroupIndex];
  const failedResult = state.testResult.test.success ? state.testResult.build : state.testResult.test;

  // Try fixing for each package in the group
  for (const pkg of group.packages) {
    logger.newLine();
    const fixResult = await fixer.fixBreakingChanges(pkg, failedResult);

    if (fixResult.success && fixResult.edits.length > 0) {
      return {
        fixAttempts: state.fixAttempts + 1,
        phase: WorkflowState.VALIDATE,
      };
    }
  }

  // No fixes generated
  return {
    fixAttempts: state.fixAttempts + 1,
    error: 'No fixes could be generated',
    phase: WorkflowState.COMPLETE,
  };
}

/**
 * VALIDATE node - Re-run tests after fixing
 */
async function validateNode(state: GraphState): Promise<Partial<GraphState>> {
  logger.newLine();

  const { tester } = initComponents(state.config);
  const results = await tester.runAll(state.config.buildCommand, state.config.testCommand);

  if (results.success) {
    logger.success('Fixes applied successfully! Tests now pass.');
    return {
      testResult: results,
      phase: WorkflowState.COMMIT,
    };
  }

  logger.warn('Fixes applied but tests still fail');

  // Try again if we haven't hit max retries
  if (state.fixAttempts < state.config.maxRetries) {
    return {
      testResult: results,
      phase: WorkflowState.LOCALIZE,
    };
  }

  return {
    testResult: results,
    error: 'Tests still fail after maximum fix attempts',
    phase: WorkflowState.COMPLETE,
  };
}

/**
 * COMMIT node - Commit changes and move to next group
 */
async function commitNode(state: GraphState): Promise<Partial<GraphState>> {
  const group = state.groups[state.currentGroupIndex];
  const { git, updater, editEngine } = initComponents(state.config);

  logger.success(`Group ${state.currentGroupIndex + 1} upgraded successfully!`);

  // Commit if enabled
  if (state.config.createCommits && state.isGitRepo) {
    logger.newLine();
    await git.commitPackageUpdate(group.packages);
    updater.clearBackup();
    editEngine.clearHistory();
  }

  // Check if there are more groups
  const nextIndex = state.currentGroupIndex + 1;
  if (nextIndex < state.groups.length) {
    return {
      currentGroupIndex: nextIndex,
      completedGroups: [state.currentGroupIndex],
      phase: WorkflowState.UPDATE,
    };
  }

  // All done!
  return {
    completedGroups: [state.currentGroupIndex],
    phase: WorkflowState.COMPLETE,
  };
}

/**
 * COMPLETE node - Final summary
 */
async function completeNode(state: GraphState): Promise<Partial<GraphState>> {
  if (state.error) {
    // Handle failure
    const { updater, editEngine } = initComponents(state.config);

    logger.error(state.error);
    logger.info('Rolling back changes...');

    try {
      await updater.rollback();
      await editEngine.rollback();
    } catch (e) {
      logger.error('Rollback failed', e as Error);
    }

    return { phase: WorkflowState.COMPLETE };
  }

  // Success!
  if (state.packages.length > 0 && !state.config.dryRun) {
    logger.section('Success! 🎉');
    logger.success('All packages upgraded successfully');
    logger.newLine();
    logger.info('Summary:');
    state.packages.forEach((pkg) => {
      logger.listItem(`${pkg.name}: ${pkg.currentVersion} → ${pkg.latestVersion}`, 1);
    });
  }

  return { phase: WorkflowState.COMPLETE };
}

// ============================================================================
// GRAPH DEFINITION
// ============================================================================

/**
 * Route from analyze based on whether there are packages
 */
function routeAfterAnalyze(state: GraphState): string {
  if (state.phase === WorkflowState.COMPLETE) return 'complete';
  return 'group';
}

/**
 * Route from group based on dry run
 */
function routeAfterGroup(state: GraphState): string {
  if (state.phase === WorkflowState.COMPLETE) return 'complete';
  return 'update';
}

/**
 * Route from reproduce based on test success
 */
function routeAfterReproduce(state: GraphState): string {
  if (state.phase === WorkflowState.COMMIT) return 'commit';
  return 'localize';
}

/**
 * Route from localize
 */
function routeAfterLocalize(state: GraphState): string {
  if (state.phase === WorkflowState.COMPLETE) return 'complete';
  return 'fix';
}

/**
 * Route from fix
 */
function routeAfterFix(state: GraphState): string {
  if (state.phase === WorkflowState.COMPLETE) return 'complete';
  return 'validate';
}

/**
 * Route from validate
 */
function routeAfterValidate(state: GraphState): string {
  if (state.phase === WorkflowState.COMMIT) return 'commit';
  if (state.phase === WorkflowState.COMPLETE) return 'complete';
  return 'localize';
}

/**
 * Route from commit
 */
function routeAfterCommit(state: GraphState): string {
  if (state.phase === WorkflowState.UPDATE) return 'update';
  return 'complete';
}

/**
 * Build the workflow graph
 */
export function createWorkflowGraph(checkpointer?: BaseCheckpointSaver) {
  const graph = new StateGraph(WorkflowStateAnnotation)
    // Add nodes
    .addNode('analyze', analyzeNode)
    .addNode('group', groupNode)
    .addNode('update', updateNode)
    .addNode('reproduce', reproduceNode)
    .addNode('localize', localizeNode)
    .addNode('fix', fixNode)
    .addNode('validate', validateNode)
    .addNode('commit', commitNode)
    .addNode('complete', completeNode)

    // Add edges
    .addEdge(START, 'analyze')
    .addConditionalEdges('analyze', routeAfterAnalyze, ['group', 'complete'])
    .addConditionalEdges('group', routeAfterGroup, ['update', 'complete'])
    .addEdge('update', 'reproduce')
    .addConditionalEdges('reproduce', routeAfterReproduce, ['commit', 'localize'])
    .addConditionalEdges('localize', routeAfterLocalize, ['fix', 'complete'])
    .addConditionalEdges('fix', routeAfterFix, ['validate', 'complete'])
    .addConditionalEdges('validate', routeAfterValidate, ['commit', 'localize', 'complete'])
    .addConditionalEdges('commit', routeAfterCommit, ['update', 'complete'])
    .addEdge('complete', END);

  // Compile with optional checkpointer for persistence
  return graph.compile({ checkpointer });
}

/**
 * Run the upgrade workflow
 */
export async function runWorkflow(
  config: Config,
  options?: {
    checkpointer?: BaseCheckpointSaver;
    threadId?: string;
    resume?: boolean;
  }
): Promise<{ success: boolean; error?: string }> {
  // Reset components for fresh run
  resetComponents();

  const checkpointer = options?.checkpointer || new MemorySaver();
  const threadId = options?.threadId || `upgrade-${Date.now()}`;
  const resume = options?.resume || false;

  const graph = createWorkflowGraph(checkpointer);

  try {
    let finalState;

    if (resume) {
      // Resume from saved state - invoke with null input continues from checkpoint
      logger.info('Resuming from saved state...');
      finalState = await graph.invoke(null, {
        configurable: { thread_id: threadId },
      });
    } else {
      // Fresh start
      const initialState: Partial<GraphState> = {
        config,
        phase: WorkflowState.ANALYZE,
      };

      finalState = await graph.invoke(initialState, {
        configurable: { thread_id: threadId },
      });
    }

    return {
      success: !finalState.error,
      error: finalState.error || undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Re-export FileCheckpointer
export { FileCheckpointer, createFileCheckpointer } from './file-checkpointer.js';
