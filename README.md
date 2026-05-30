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

The workflow relies on three specialized personas defined in the `.harness/` folder:
1. **Planner** (`planner_prompt.md`): Takes a simple goal and expands it into an ambitious `feature_list.json` specification. 
2. **Generator** (`generator_prompt.md`): Operates in sprints. It picks up the next uncompleted feature from `feature_list.json`, writes a `sprint_contract.md`, writes the code, and commits changes via Git.
3. **Evaluator** (`evaluator_prompt.md`): The QA phase. It writes automated tests (like Playwright) to test the Generator's work, providing detailed feedback in `sprint_feedback.md` if it fails, or marking the feature as passing.

## Usage

### 1. Standard Workflow (Full Autonomy)
Run the harness by supplying a single, high-level goal. The Planner will break it down into actionable tasks.
```bash
ai-harness "Build a 2D retro game maker with a level editor and test mode"
```

### 2. Bring-Your-Own-Plan (Skip the Planner)
If you already have a roadmap, you can skip the Planner and jump straight into the Generator/Evaluator loop. You can provide a directory of Markdown issues, or a JSON file.
```bash
ai-harness --tasks ./issues
```
The orchestrator will seamlessly parse your files into the strict `feature_list.json` format. *(Note: To prevent accidental overwrites, the harness will abort if `feature_list.json` already exists. Use `--force` to override).*

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
