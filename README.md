# Devpost Auto-Upgrader

An AI-powered dependency upgrade tool that automatically handles breaking changes when updating npm packages.

## Overview

Traditional dependency management tools like Dependabot can update your dependencies, but they don't fix the breaking changes that come with those updates. This tool uses Gemini 3 AI to:

1. Analyze your outdated dependencies
2. Intelligently group related packages
3. Update dependencies and run tests
4. Search for migration guides when tests fail
5. Automatically fix breaking changes in your codebase
6. Create clean git commits for each successful upgrade

## Built For

This project was created for the [Google DeepMind Gemini 3 Hackathon](https://gemini3.devpost.com/) as an entry in the **Marathon Agent** track - demonstrating autonomous AI systems that can handle complex, multi-step tasks.

## Features

- 🤖 **AI-Powered Grouping**: Gemini 3 intelligently groups related packages (e.g., React ecosystem)
- 🔍 **Smart Migration Search**: Automatically finds and synthesizes migration guides from the web
- 🛠️ **Automated Fixing**: Uses Gemini 3's 1M token context to understand your entire codebase and generate precise fixes
- 🔄 **Iterative Refinement**: Re-runs tests after each fix attempt, self-correcting until tests pass
- 💾 **Git Integration**: Creates atomic commits for each successful update group
- 🎯 **Safe Rollback**: Automatically reverts changes if fixes fail after max retries

## Installation

```bash
npm install -g devpost-autoupgrader
```

## Usage

### Basic Usage

```bash
# Set your Gemini API key
export GEMINI_API_KEY="your_api_key_here"

# Run in your project directory
cd your-project
devpost-upgrade
```

### Options

```bash
# Dry run - preview changes without applying
devpost-upgrade --dry-run

# Interactive mode - confirm each step
devpost-upgrade --interactive

# Skip creating commits
devpost-upgrade --no-commit

# Manually specify package groups
devpost-upgrade --group "react,react-dom,react-router"
```

## How It Works

1. **Analysis**: Runs `npm-check-updates` to find outdated packages
2. **Grouping**: Gemini 3 analyzes packages and groups related ones together
3. **Update**: Updates `package.json` and runs `npm install`
4. **Test**: Runs your build and test scripts
5. **Fix** (if tests fail):
   - Searches web for migration guides
   - Sends entire codebase + errors + guides to Gemini 3
   - Generates precise search-and-replace fixes
   - Applies fixes and re-runs tests
6. **Commit**: Creates git commit on success, or rolls back on failure

## Architecture

Built with proven patterns from leading open-source coding agents:

- **LangGraph**: State machine orchestration for multi-step workflows
- **Aider-inspired**: Repository mapping for efficient codebase context
- **SWE-agent pattern**: Reproduce → Localize → Fix workflow

```mermaid
flowchart LR
  "CLI Entry" --> "Analyze Dependencies"
  "Analyze Dependencies" --> "AI Grouping (Gemini 3)"
  "AI Grouping (Gemini 3)" --> "Update Packages"
  "Update Packages" --> "Run Tests"
  "Run Tests" --> "Pass"
  "Run Tests" --> "Fail"
  "Fail" --> "Find Migration Guides"
  "Find Migration Guides" --> "AI Fixes (Gemini 3)"
  "AI Fixes (Gemini 3)" --> "Re-run Tests"
  "Re-run Tests" --> "Pass"
  "Pass" --> "Create Commit"
```

### Technology Stack

- TypeScript + Node.js 18+
- Gemini 3 Pro API (1M token context)
- LangGraph for agent orchestration
- Commander.js for CLI

## Configuration

Create `.devpost-upgrader.json` in your project root:

```json
{
  "buildCommand": "npm run build",
  "testCommand": "npm test",
  "maxRetries": 3,
  "createCommits": true,
  "geminiModel": "gemini-3-pro-preview"
}
```

## Development

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run in development mode
npm run dev

# Run tests
npm test

# Type checking
npm run type-check
```

## Examples

See the `examples/` directory for demonstration projects:

- `react-17-to-18/`: React 17 → 18 upgrade with breaking changes
- `jest-28-to-29/`: Jest 28 → 29 upgrade
- `simple-deps/`: Simple dependency updates

## Demo Script (3 Minutes)

Use this flow to record a clean, repeatable demo for judges.

```bash
# 1) Build the CLI
npm install
npm run build

# 2) Run the simple demo project
cd examples/simple-deps
../../dist/cli.js --dry-run

# 3) Run the full upgrade (optional)
# Initialize git repo if needed for commits
git init
git add .
git commit -m "Initial commit"
../../dist/cli.js
```

**Expected highlights in the demo:**
- AI grouping with a clear explanation
- Deterministic upgrade steps
- Tests passing and a clean commit created

## Limitations

- Currently supports npm/yarn only (pnpm support planned)
- JavaScript/TypeScript projects only
- Requires tests to be present in the project
- Migration guide quality depends on available documentation

## Contributing

This is a hackathon project, but contributions are welcome! Please open an issue or PR.

## License

MIT

## Acknowledgments

- Inspired by [Google Antigravity](https://cloud.google.com/blog/topics/developers-practitioners/agent-factory-recap-building-with-gemini-3-ai-studio-antigravity-and-nano-banana) and the Action Era of autonomous agents
- Architecture patterns from [Aider](https://github.com/Aider-AI/aider) and [SWE-agent](https://github.com/SWE-agent/SWE-agent)
- Built with [LangGraph](https://www.langchain.com/langgraph) for agent orchestration
