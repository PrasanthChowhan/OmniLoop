# Long-Running AI Harness

This repository implements a 3-agent orchestration architecture for long-running, autonomous AI engineering tasks (inspired by Anthropic's research on effective agent harnesses). 

It has been rebuilt from the ground up in **Node.js/TypeScript** to provide a global, easy-to-use CLI and tight integration with modern web development ecosystems.

## Installation

To install the orchestrator globally on your machine:
```bash
npm install
npm run build
npm link
```
You can now run `ai-harness` from any empty directory on your machine!

## Architecture

This harness utilizes a **Ralph-like loop** via a Master Orchestrator script (`src/index.ts`). It is designed to eliminate **context rot** by spinning up fresh AI contexts for every micro-task.

The workflow now relies on a two-phase sprint execution utilizing five specialized personas defined in the `.harness/` folder:

1. **Planner** (`planner_prompt.md`): Takes a simple goal and expands it into an ambitious `.harness/feature_list.json` specification, while scaffolding the environment via `.harness/init.sh`.
2. **Contractor** (`contractor_prompt.md`): The Technical Lead. Picks up the next feature and defines *exactly how* it will be built by writing a `.harness/sprint_contract.md`.
3. **Contract Evaluator** (`contract_evaluator_prompt.md`): The Architect. Reviews the contract *before* any code is written, ensuring architectural alignment and testability.
4. **Generator** (`generator_prompt.md`): The Coder. Operates with pure focus to strictly implement the approved contract, then safely commits changes via Git.
5. **Evaluator** (`evaluator_prompt.md`): The QA phase. Writes automated tests (like Playwright) to test the Generator's work end-to-end, providing detailed feedback in `.harness/sprint_feedback.md` if it fails, or marking the feature as passing.

## Usage

### 1. Standard Workflow (Full Autonomy)
Run the harness by supplying a single, high-level goal. The Planner will break it down into actionable tasks.
```bash
ai-harness "Build a 2D retro game maker with a level editor and test mode"
```

### 2. Bring-Your-Own-Plan (Only Ralph Loop)
If you already have a roadmap or manually created a `.harness/feature_list.json` file, you can skip the Planner and jump straight into the Generator/Evaluator loop (the "Ralph Loop"). 

**Option A: Let the harness parse your markdown issues**
Provide a directory of Markdown issues, or a JSON file:
```bash
ai-harness --tasks ./issues
```
The orchestrator will seamlessly parse your files into the strict `.harness/feature_list.json` format and start the Ralph Loop. *(Note: To prevent accidental overwrites, the harness will abort if the list already exists. Use `--force` to override).*

**Option B: Resume an existing plan**
If `.harness/feature_list.json` already exists in your workspace (either manually authored or leftover from a paused run), simply run the command with no arguments to enter the Ralph Loop and pick up the next uncompleted feature:
```bash
ai-harness
```

## CLI Flags Reference

The orchestrator supports several flags to customize its execution and manage state:

| Flag | Description |
|------|-------------|
| `--tasks <path>` | Skips the Planner agent. Parses a directory of markdown files or a JSON file to build `.harness/feature_list.json` and begins the Ralph loop. |
| `--force` | Forces the orchestrator to overwrite an existing `.harness/feature_list.json` when using the `--tasks` flag. |
| `--no-test` | Bypasses the Evaluator agent entirely during the Ralph Loop. Assume the generator's code is correct, saving time and tokens when rigid UI testing is overkill. |
| `--context <path>` | Appends an explicit file to the AI's context window. Extremely useful for injecting custom architecture docs or API references for a specific run. |
| `--resume-from-commit <hash>` | Instantly rolls the project state back to a specific git commit hash before resuming the harness loop. |
| `--retry-feature <id>` | Marks a previously completed or failed feature (by ID) as `passes: false` in the feature list, forcing the harness to roll back and retry it. |
| `--docker` | Runs the agent model via a sandboxed Docker container (`docker run gemini`) instead of the default local Node CLI execution. |

## Context Injection & Progressive Disclosure

To write great code, AI needs to understand your project's rules, architecture, and tech stack. 

The `ai-harness` features an advanced **automatic context engine** that supports industry-standard *Progressive Disclosure*:
* **Global Rules**: It automatically looks for and injects `context.md` or `AGENTS.md` found in your project root.
* **Modular Rules**: It automatically and recursively scans `.agents`, `.gemini`, and `.claude` directories, gathering every `.md` and `.txt` file it finds. This makes the harness completely cross-compatible with rules written for Cursor or Claude!
* **Manual Injection**: Use the `--context <path>` flag to explicitly append an extra file to the context.

```bash
ai-harness --tasks ./issues --context ./architecture_doc.md
```

## State Management & Resilience

This harness is built with **Durable State** to ensure you never lose progress to an API timeout, rate limit, or power outage:
- **Resumes Automatically**: `feature_list.json` tracks progress. If you lose power, just run `ai-harness` again and it picks up exactly where it left off.
- **Evaluator Self-Healing**: If generated code fails tests, the Evaluator saves the crash logs to `sprint_feedback.md`. On the next retry, these logs are explicitly injected into the Generator's prompt so it can fix its own bugs.
- **Git Safety Net**: The Generator commits passing code at the end of every successful sprint.
- **Time-Travel Recovery**: Use built-in flags like `--resume-from-commit <hash>` or `--retry-feature <id>` to instantly rollback state if the AI goes down a rabbit hole.
