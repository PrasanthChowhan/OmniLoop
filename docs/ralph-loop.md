# The Ralph Loop (Ralph Wiggum Pattern)

## Overview
The **Ralph Loop** (often referred to as the "Ralph Wiggum" technique, named after the persistently oblivious Simpsons character) is a robust architectural pattern used for long-running AI coding agents. It is designed to combat **"agentic laziness,"** context window exhaustion, and false completions.

Instead of trying to force an LLM to complete a massive, multi-file feature in a single shot (which usually results in the agent giving up, hallucinating, or hitting context limits), the agent is wrapped in an uncompromising loop.

## Core Mechanics
1. **The Loop Harness**: An external orchestrator (often a simple `while` loop in a shell script, or an orchestrator like OmniLoop) continuously spawns the agent.
2. **Stateless Sessions (Fresh Context)**: To prevent context bloat, the agent's conversation history is frequently wiped. The agent starts fresh on each iteration.
3. **Durable State on Disk**: Because conversation history is wiped, the "memory" of the agent must live in the filesystem. This is typically managed via:
   - Version Control (Git diffs, commit history).
   - A durable task list or blueprint (e.g., `blueprint.json`, `todo.md`, `sprint_contract.md`).
4. **Relentless Persistence**: The loop intercepts any attempt by the agent to exit prematurely. If the task (as defined by the durable state) is not complete or tests are failing, the loop re-spawns the agent and tells it to continue.

## Why Anthropic Uses It
Anthropic researchers and the broader AI engineering community (including tools like Claude Code) use this pattern to build complex systems (like C compilers from scratch) autonomously. 
- **Solves Context Anxiety**: Agents get "anxious" when they see the token limit approaching and tend to wrap up hastily. A fresh context window cures this.
- **Enforces Rigor**: By pairing the Ralph Loop with an Evaluator or automated tests, the agent is forced to keep trying until it actually works, rather than just claiming it works.

## Best Practices & System Prompts

To make a Ralph Loop effective, the system prompts must be strictly tailored for stateless execution.

### 1. The "Amnesia" Prompt Pattern
The agent must be explicitly told that it is in a loop and its memory is on disk.
**Example Prompt Snippet:**
> "You are an autonomous developer executing inside a Ralph Loop. You have no memory of previous conversation turns. To understand the current state of the project, you MUST read the git commit history, run `npm test`, and review the `blueprint.json`. Do not guess what was done previously."

### 2. Micro-Commit Strategy
The agent should be instructed to commit work frequently.
**Example Prompt Snippet:**
> "When you complete a logical chunk of work, commit it to git immediately. If you encounter a complex error, write your current thoughts to `omniloop-progress.txt` and exit. The loop will restart you with a fresh context window to tackle the error."

### 3. Clear Exit Conditions
The loop needs to know when to finally stop. The agent must have a strict protocol for signaling completion.
**Example Prompt Snippet:**
> "If and only if all requirements in the sprint contract are met AND all tests pass, exit with code 0. If you are stuck or need to refresh your context, exit with code 1. The orchestrator will handle the rest."

## Integration into OmniLoop (The "Raw Flow")
In the context of the OmniLoop architecture, the Ralph Loop represents the **Directed Execution Mode**. 
Instead of the heavy multi-agent negotiation (Planner -> Contractor -> Reviewer), the Ralph Loop takes a defined task (e.g., a GitHub issue) and mercilessly loops the **Generator** (and optionally the **Evaluator**) until the code is written, tested, and merged. 

This provides a highly efficient, deterministic pipeline for well-scoped tasks.
