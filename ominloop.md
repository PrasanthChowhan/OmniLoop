# OmniLoop Architecture & Security Model

OmniLoop is a 100% prompt-driven, work-agnostic orchestration engine. Instead of relying on hardcoded TypeScript adapters to fetch tasks (like connecting to Jira APIs or parsing custom text files), OmniLoop leverages an autonomous **Planner Agent** and a powerful, secure **Prompt Preprocessor**.

This document outlines how the system operates and, crucially, how it prevents malicious execution.

## 1. The Work-Agnostic Workflow

OmniLoop doesn't care where your tasks live. The workflow is entirely driven by natural language and local shell commands:

1. **The Planner Phase**: When you run `omniloop --mode ralph`, the system spins up a Planner Agent. Its only job is to understand your goal, find the tasks, figure out the dependencies, and output a structured JSON `<plan>`.
2. **The Execution Phase**: The orchestrator parses the `<plan>` into a `blueprint.json` and begins the Ralph Loop, spinning up **Generator** and **Evaluator** agents to systematically execute and verify each task.

### How it handles different scenarios:
* **GitHub Issues (`--github`)**: OmniLoop injects a shell command (`!gh issue list...`) into the prompt. The preprocessor executes it locally and feeds the live JSON directly to the Planner Agent.
* **Task Folders (`--tasks ./folder`)**: OmniLoop injects a shell command (`!cat ./folder/*.md`) to dump all task definitions into the prompt for the Planner Agent to organize.
* **Custom Instructions**: If you ask it to "read `tasks.json`", the Planner Agent simply uses its own native file-reading tools to pull the data.

---

## 2. Dynamic Templating (`{{KEY}}`)
OmniLoop templates (located in `.omniloop/`) use `{{KEY}}` syntax for dynamic variables. 
Instead of concatenating massive strings in TypeScript, the Orchestrator passes a dictionary of arguments to the `PromptResolver`. 

For example, a task in your blueprint might define a `customSystemPrompt`. This gets safely injected into `{{CUSTOM_SYSTEM_PROMPT}}` right before the agent runs, allowing for per-task personas.

---

## 3. Preprocessor Shell Expansion (`!`command``)
To prevent the AI from wasting tokens trying to explore your environment, you can hardcode shell commands directly into your prompt templates using the `!`command`` syntax.

**Example in `generator_prompt.md`:**
```markdown
# Current Workspace Setup
!`tree -L 2`
```
When `PromptResolver.ts` loads this template, it executes `tree -L 2` on your machine and replaces the block with the raw output *before* the LLM ever sees it. This gives the AI instant context.

---

## 4. The Security Model (Preventing Prompt Injection)

Allowing a preprocessor to blindly execute shell commands is incredibly dangerous. If a user defines a task via an external file or a GitHub issue titled `Fix bug !rm -rf /`, the system could theoretically execute a malicious command.

OmniLoop prevents this using a **Hidden Marker System** (`SHELL_BLOCK_MARKER = \x01`).

### How it stays safe:
1. **Trusting the Source**: When OmniLoop loads the *trusted* `_prompt.md` file (or trusted internal CLI injections), it scans for legitimate `!`command`` blocks and tags them with a hidden, un-typable character (`\x01`).
2. **Sanitizing the Input**: Before injecting dynamic variables (like the `{{TASK_DESCRIPTION}}` pulled from an external `tasks.json`), OmniLoop aggressively strips any `\x01` characters found in the user's data. 
3. **Execution**: Finally, the system executes *only* the shell blocks that still possess the hidden `\x01` marker. 

If a malicious string like `!`rm -rf /`` is passed dynamically, it lacks the trusted marker. The system completely ignores it, rendering it as harmless plain text for the AI to read. This guarantees that OmniLoop has the extreme power of preprocessor execution without the vulnerability of command injection.
