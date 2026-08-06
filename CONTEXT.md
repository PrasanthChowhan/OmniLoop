# OmniLoop Context & Domain Knowledge

This document consolidates high-level domain knowledge, orchestration logic, and harness execution parameters. It should be used by developers and AI agents to understand the "why" and "how" of the OmniLoop system without polluting the strict guardrails in `AGENTS.md`.

## 1. Domain: Long-Running App Generation

OmniLoop is an orchestration engine designed for long-running, autonomous AI engineering tasks. It implements an incremental **Sprint**-based workflow managed by a Master Orchestrator.

### Core Concepts:
- **Planner Phase**: Understands a high-level goal, finds tasks, and outputs a structured `<plan>` (`blueprint.json`).
- **Sprint Phase**: Executes the plan incrementally.
- **Agent Personas**:
  - **Planner**: Expands a goal into a Blueprint.
  - **Contractor**: Defines exactly how a feature is built via a Sprint Contract.
  - **Reviewer**: Reviews the Contract.
  - **Generator**: Writes the code.
  - **Evaluator**: Empirically tests the code and updates the Blueprint.

## 2. Orchestration Flow & State Management

OmniLoop relies on **Durable State** to prevent context rot and allow safe resumption.

- **Workspace (`.omniloop/`)**: Holds all durable state (`blueprint.json`, `sprint_contract.md`, `sprint_feedback.md`, `omniloop-progress.txt`, etc.).
- **VCS Integration**: OmniLoop branches for features, and commits state checkpoints at the end of successful sprints.
- **Context Cycle**: If code fails, the Evaluator saves logs. On the next cycle, these logs are injected into the Generator's prompt.
- **Context Compaction**: Feedback and contracts are truncated from the *beginning* (suffix-preserving) to prevent evicting the most recent, critical errors.

## 3. Dynamic Templating & Execution Preprocessor

OmniLoop utilizes a secure templating and execution engine for its prompts.

- **Variable Injection (`{{KEY}}`)**: Used for dynamic variables injected into prompts.
- **Shell Expansion (`!command`)**: Trusted prompt templates can execute local shell commands to gather immediate context (e.g., `!tree -L 2`).
- **Security Model (Hidden Marker System)**: To prevent command injection from external task names or issues, OmniLoop tags legitimate shell commands from trusted templates with a hidden marker (`\x01`). Any `!command` syntax found in injected data (like a task description) lacks this marker and is safely ignored as plain text.

## 4. Work-Agnostic Inputs

OmniLoop doesn't rely on hardcoded API adapters.
- `--github`: Injects `gh issue list` into the planner.
- `--tasks <path>`: Injects `cat` commands to dump text files to the planner.
- All input methods eventually produce a `blueprint.json` which the core loop executes.
