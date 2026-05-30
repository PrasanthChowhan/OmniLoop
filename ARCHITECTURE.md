# Long-Running Agent Harness Architecture

## Overview
This project implements a multi-agent harness for long-running, autonomous application development. It is heavily inspired by Anthropic's research on [Harness Design for Long-Running Apps](https://www.anthropic.com/engineering/harness-design-long-running-apps) and [Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).

The goal of this harness is to solve common failure modes of LLMs when dealing with complex, multi-step engineering tasks, such as:
1. **Context Exhaustion & One-Shotting:** Trying to do too much in a single context window and running out of space, leaving code in a broken state.
2. **Context Anxiety:** Prematurely wrapping up tasks as the context limit approaches.
3. **False Completions:** Marking Features as complete without sufficient empirical testing.
4. **Self-Evaluation Bias:** Agents grading their own generated outputs too generously, leading to generic or non-functional products.

To achieve this, the harness separates concerns across a GAN-inspired (Generative Adversarial Network) multi-agent architecture with a strict workflow: **Planner -> (Contractor ↔ Reviewer) -> (Generator ↔ Evaluator)**.

## Core Concepts & "The Why" (Ubiquitous Language)

### 1. Separation of Concerns (The GAN Pattern)
**Why:** When asked to evaluate work they've produced, agents tend to respond by confidently praising it—even when the quality is mediocre.
**How:** By separating the **Generator** (who writes the code) from the **Evaluator** (who tests and critiques it), we create a feedback loop that drives the **Generator** toward stronger, more polished outputs. The **Evaluator** acts as an adversarial check with hard quality thresholds for both functionality and aesthetics.

### 2. Incremental Progress (The Ralph Loop)
**Why:** Models lose coherence on lengthy tasks. We must avoid monolithic generation.
**How:** We break the project down into atomic **Features** via a durable **Blueprint** (`.harness/blueprint.json`). The agent works on only one **Feature** at a time, branching in the **VCS**, and committing changes. This ensures the environment is left in a clean, mergeable state after every step.

### 3. Contract Negotiation Before Code
**Why:** Vague requirements lead to divergent implementations and testing failures, cascading errors down the pipeline.
**How:** Before writing code for a **Sprint**, a **Contractor** agent proposes a `.harness/sprint_contract.md` detailing implementation and success metrics. A **Reviewer** reviews this. Only when approved (`.harness/contract_approved.txt`) does the **Generator** start coding. This bridges the gap between high-level specs and testable code.

### 4. Empirical Testing & Meta-Evaluation (Chaos Testing)
**Why:** Agents often verify code statically or perform shallow tests, marking broken features as "done".
**How:** The **Evaluator** is forced to write actual UI automation tests (e.g., Playwright/Puppeteer) and behave like a human user. Furthermore, in the first **Cycle** of a **Sprint**, the harness injects a blatant syntax bug (**Chaos Test**). The **Evaluator** MUST fail the build. If it passes the broken build, it fails the meta-evaluation, preventing "false passes" due to lazy testing.

### 5. Durable State and Handoffs
**Why:** Each context window starts fresh (context resets). The agent needs to quickly understand what happened previously without a massive context history overhead.
**How:** We maintain durable artifacts:
- `.harness/blueprint.json`: The source of truth for all **Project** requirements and **Sprint** states.
- `.harness/claude-progress.txt`: A living log of what has been done.
- **VCS Commit History:** Provides exact code diffs and rollback capabilities if an agent goes off the rails.

## Architecture & Agent Personas

### 1. Planner Agent (`.harness/planner_prompt.md`)
- **Role:** The Architect & Visionary.
- **Task:** Expands a simple user prompt into a high-fidelity **Blueprint**. Focuses on product context and high-level technical design rather than granular implementation.
- **Output:** Creates `.harness/blueprint.json` and an `.harness/init.sh` script to set up the environment. *It does NOT write app logic.*

### 2. Contractor Agent (`.harness/contractor_prompt.md`)
- **Role:** The Specifier.
- **Task:** Defines the specific implementation details for the upcoming **Sprint**.
- **Output:** Creates `.harness/sprint_contract.md`.

### 3. Reviewer Agent (`.harness/reviewer_prompt.md`)
- **Role:** The Blueprint Reviewer (formerly Contract Evaluator).
- **Task:** Reviews the **Contractor's** proposal to ensure architectural soundness and alignment with the **Blueprint**.
- **Output:** Approves with `.harness/contract_approved.txt` or rejects with detailed feedback in `.harness/sprint_feedback.md`.

### 4. Generator Agent (`.harness/generator_prompt.md`)
- **Role:** The Craftsman (Lead Developer).
- **Task:** Implements the **Feature** exactly as specified in the approved **Contract**. Focuses on code quality, type safety, and UI fidelity.
- **Output:** Commits code to the **VCS**, appends progress to `claude-progress.txt`.

### 5. Evaluator Agent (`.harness/evaluator_prompt.md`)
- **Role:** The Critic & Guardian (Head of QA and Design).
- **Task:** Tests the **Generator's** work empirically against functionality, aesthetics, and robustness. Fails the build if it doesn't meet the high bar.
- **Output:** Updates the **Blueprint** to passing upon success, or writes gritty critique back into `sprint_feedback.md` upon failure.

## Workflow Lifecycle (`src/index.ts`)

The harness is modularized into several key components:

1. **`Workspace`**: Owns the knowledge of the harness directory structure (`.harness`) and provides a deep interface for state persistence (metrics, traces, features).
2. **`Vcs` (GitVcs)**: Abstracts source control operations, providing a clean interface for branch management and state checkpoints.
3. **`ContextSynthesizer`**: Decouples the complex logic of gathering surgical context (VCS diffs, Ctags, project files) from the orchestration logic.
4. **`FeatureSource`**: Provides an abstraction for fetching work from different sources, such as GitHub issues or local task files.

### The Loop
1. **Initialization:** The CLI initializes the modules and either fetches **Features** from a **FeatureSource** or runs the **Planner** to generate the **Blueprint**.
2. **Sprint Loop:** The `SprintOrchestrator` manages the lifecycle for each unpassed **Feature**:
   - Git checkout a new feature branch via the **VCS**.
   - **Contract Phase:** **Contractor** and **Reviewer** iterate until a **Sprint Contract** is approved.
   - **Implementation Phase:** **Generator** writes code. **Evaluator** tests it.
     - *Note: On the first Cycle, a chaos bug is injected to test the Evaluator's honesty.*
   - Once the **Evaluator** passes the **Feature**, the branch is merged via the **VCS** and the durable state is committed.
3. **Completion:** The loop continues until all **Features** in the **Blueprint** pass.

This document serves as the foundational context for any future AI agent or human developer interacting with, maintaining, or improving this harness.
