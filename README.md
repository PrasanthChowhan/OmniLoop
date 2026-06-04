# OmniLoop

This repository implements a multi-agent orchestration architecture for long-running, autonomous AI engineering tasks (inspired by Anthropic's research on effective agent omniloopes). 

It is built in **Node.js/TypeScript** to provide a global, easy-to-use CLI and tight integration with modern web development ecosystems.

## Installation

To install the orchestrator globally on your machine:
```bash
npm install
npm run build
npm link
```
You can now run `omniloop` from any directory on your machine!

## Architecture (Ubiquitous Language)

This omniloop utilizes an incremental **Sprint**-based workflow managed by a Master Orchestrator. It is designed to eliminate **context rot** by spinning up fresh AI contexts for every micro-task.

The workflow relies on a multi-phase execution utilizing specialized **Agent** personas defined in the `.omniloop/` folder:

1. **Planner** (`planner_prompt.md`): Takes a high-level goal and expands it into an ambitious **Blueprint** (`.omniloop/blueprint.json`), while optionally scaffolding the environment via `.omniloop/init.sh`.
2. **Contractor** (`contractor_prompt.md`): The Technical Lead. Picks up the next **Feature** and defines *exactly how* it will be built by writing a **Sprint Contract** (`.omniloop/sprint_contract.md`).
3. **Reviewer** (`reviewer_prompt.md`): The Architect (formerly Contract Evaluator). Reviews the **Contract** *before* any code is written, ensuring architectural alignment and testability.
4. **Generator** (`generator_prompt.md`): The Coder. Operates with pure focus to strictly implement the approved **Contract**, then safely commits changes via the **VCS**.
5. **Evaluator** (`evaluator_prompt.md`): The Guardian. Performs empirical testing (like Playwright/Puppeteer) to verify the **Generator's** work, providing detailed feedback if it fails, or marking the **Feature** as passing.

## Usage

### 1. Standard Workflow (Full Autonomy)
Run the omniloop by supplying a single, high-level goal. The **Planner** will break it down into actionable **Features**.
```bash
omniloop "Build a 2D retro game maker with a level editor and test mode"
```

### 2. Bring-Your-Own-Plan
If you already have a roadmap or manually created a `.omniloop/blueprint.json` file, you can skip the **Planner** and jump straight into the **Sprint** loop. 

**Option A: Ingest Features from external sources**
Provide a directory of Markdown files, or a JSON file:
```bash
omniloop --tasks ./issues
```
The orchestrator will use its **Feature Source** logic to parse your files into the **Blueprint** format and start the **Sprints**. *(Note: To prevent accidental overwrites, the omniloop will abort if the blueprint already exists. Use `--force` to override).*

**Option B: Resume an existing Blueprint**
If `.omniloop/blueprint.json` already exists in your workspace (either manually authored or leftover from a paused run), simply run the command with no arguments to enter the loop and pick up the next uncompleted **Feature**:
```bash
omniloop
```

## CLI Flags Reference

| Flag | Description |
|------|-------------|
| `--tasks <path>` | Skips the Planner agent. Parses a directory of files to build `.omniloop/blueprint.json`. |
| `--force` | Forces the orchestrator to overwrite an existing `.omniloop/blueprint.json`. |
| `--no-test` | Bypasses the Evaluator agent entirely. Assume the generator's code is correct. |
| `--context <path>` | Appends an explicit file to the AI's context window. |
| `--resume-from-commit <hash>` | Instantly rolls the project state back to a specific git commit hash before resuming. |
| `--retry-feature <id>` | Marks a previously completed or failed **Feature** (by ID) as unpassed, forcing a retry. |
| `--docker` | Runs the agent model via a sandboxed Docker container. |
| `--github` | Fetches open issues with label "Ready for agent" from the GitHub repository. |

## Context Injection & Progressive Disclosure

The `omniloop` features an advanced **automatic context engine**:
* **Global Rules**: Automatically injects `context.md` or `AGENTS.md` found in your project root.
* **Modular Rules**: Recursively scans `.agents`, `.gemini`, and `.claude` directories for `.md` and `.txt` files.
* **VCS Integration**: Automatically injects relevant symbols via `ctags` or recent Git history/diffs to provide surgical context.

## State Management & Resilience

This omniloop is built with **Durable State**:
- **Resumes Automatically**: `blueprint.json` tracks progress.
- **Cycle-based Feedback**: If code fails, the **Evaluator** saves logs. On the next **Cycle**, these logs are injected into the **Generator's** prompt.
- **VCS Safety Net**: Changes are committed to the **VCS** at the end of every successful **Sprint**.
