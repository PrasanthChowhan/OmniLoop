**Part 1: The Audit Findings**

1. **[High] The "Shift Worker" Paradigm & Agent-Maintained Handoffs**
   - **The Agentic Failure Mode:** The `Generator` is designed to be a "shift worker" that arrives with zero memory, requiring explicit state handoffs. The original blueprint intends for agents to append progress to `omniloop-progress.txt` as a "living log". However, `omniloop-progress.txt` was completely missing from `Workspace.ts` and `ContextSynthesizer.ts`, forcing the system to rely solely on raw Git diffs. Without a continuously maintained progress log, the architectural intent and reasoning are lost between shifts.
   - **Code/Architecture Proof:** `src/Workspace.ts` defined durable artifacts (`blueprintFile`, `sprintContractFile`, `feedbackFile`) but lacked a `progressFile`. `src/ContextSynthesizer.ts` did not read or inject any progress file.

2. **[Medium] Context Rot & Compaction: Context Eviction**
   - **The Agentic Failure Mode:** When the `Evaluator` fails the `Generator` multiple times, large error tracebacks accumulate in `sprint_feedback.md` and `sprint_contract.md`. When these files grow beyond character limits (5000 and 8000), they were blindly truncated from the beginning (`substring(0, limit)`). This effectively evicted the newest and most critical errors at the end of the file, causing the LLM to lose the context of why it just failed.
   - **Code/Architecture Proof:** In `src/SprintOrchestrator.ts` (lines 55, 101, and 106), `feedback.substring(0, 5000)` and `contract.substring(0, 8000)` were used, preserving only the oldest context.

3. **[High] Self-Verification Skew: The "Default-FAIL" Primitive**
   - **The Agentic Failure Mode:** While the system checks `updatedFeature.passes`, it ran the `Evaluator` using the exact same context string built for the `Generator`. This meant the `Evaluator` was not operating in an isolated, "fresh" context. It inherited the `Generator's` struggles (e.g., all the accumulated `Evaluator Feedback`), violating the shift worker principle and skewing its judgment towards false positives or "context anxiety."
   - **Code/Architecture Proof:** In `src/SprintOrchestrator.ts`, the Evaluator was called passing the identical `context` variable that had `Evaluator Feedback` appended to it earlier in Phase 2 Implementation.

4. **[High] The Infinite Hallucination Loop & API Wallet Exhaustion**
   - **The Agentic Failure Mode:** The orchestrator features a strict `maxCycles` limit per sprint. If this limit was reached, `runSprint()` correctly returned `false`. However, the orchestrator's main event loop was an unhandled `while (true)`. Because the feature was never marked as passed, the orchestrator instantly fetched the exact same failing feature and re-initiated the sprint, creating an infinite hallucination loop that rapidly exhausts API budgets.
   - **Code/Architecture Proof:** `src/index.ts` contained `const success = await orchestrator.runSprint(currentFeature);` inside a `while (true)` loop with no handling for `!success` to break the loop.

5. **[Critical] Execution Security & Environment Breakouts: Indirect Prompt Injection**
   - **The Agentic Failure Mode:** The Planner agent's output is trusted to generate `.omniloop/init.sh`. The orchestrator blindly executed this shell script. If a user provided an external task list or enabled `--github` on a repository containing a malicious issue (e.g., instructing the agent to write `rm -rf /` or exfiltrate env vars), the prompt injection would bypass the `PromptResolver`'s security markers and execute directly on the host machine.
   - **Code/Architecture Proof:** `src/index.ts` executed `spawnSync('bash', [workspace.sprintInitFile], { shell: true })` without user review or sandboxing.

---

**Part 2: The Pull Request (Actionable Fixes)**

**PR Title:** fix(core): mitigate long-running agent failure modes (Anthropic shift-worker alignment)

**PR Description:**
This PR aligns OmniLoop with Anthropic's latest research on long-running agents by addressing five critical LLMOps failure modes. It enforces the "shift worker" paradigm by establishing a durable progress journal across sprints. It prevents "context rot" by intelligently compacting context strings rather than blindly truncating the newest data. It eliminates "self-verification skew" by isolating the Evaluator into a fresh context window, free from the Generator's historical struggles. Furthermore, it stops infinite API exhaustion loops when an agent hits `maxCycles`, and patches a critical remote code execution vulnerability caused by blind execution of the Planner's initialization script.

**Proposed Changes:**
*   **State Persistence (Shift Worker Paradigm):**
    *   **Where:** `src/Workspace.ts` and `src/ContextSynthesizer.ts`
    *   **What changed:** Added a `progressFile` property in `Workspace.ts` pointing to `omniloop-progress.txt`. Updated `ContextSynthesizer.ts` to read this file and append its contents to the agent context string under an `### OMNILOOP PROGRESS LOG ###` heading.
    *   **How it affects the system:** The Generator now receives explicit state handoffs from previous cycles ("shifts"), ensuring architectural intent and project progress are preserved across context resets, preventing context loss.
*   **Context Compaction Fix:**
    *   **Where:** `src/SprintOrchestrator.ts`
    *   **What changed:** Modified the context truncation logic for `feedback` (5000 character limit) and `contract` (8000 character limit). Replaced `substring(0, max)` with suffix-preserving truncation (e.g., `substring(feedback.length - max)`).
    *   **How it affects the system:** Prevents "context rot". The orchestrator now retains the most recent and critical traceback errors at the end of the feedback files instead of evicting them, allowing the LLM to successfully learn from its immediate previous failure.
*   **Self-Verification Skew Fix:**
    *   **Where:** `src/SprintOrchestrator.ts`
    *   **What changed:** Separated the implementation cycle context into `generatorContext` and `evaluatorContext`. The Evaluator now receives a clean context generated by `contextSynthesizer.getSurgicalContext()` and `"No previous feedback."`, instead of inheriting the Generator's exact context string which included old Evaluator feedback.
    *   **How it affects the system:** Ensures the Evaluator operates in a pristine, unbiased environment. This eliminates "self-verification skew" where the Evaluator might be influenced by the Generator's previous struggles or fake test logs.
*   **Infinite Hallucination Loop Fix:**
    *   **Where:** `src/index.ts`
    *   **What changed:** Added a loop breaker condition `if (!success) { break; }` directly after `const success = await orchestrator.runSprint(currentFeature);` inside the orchestrator's `while (true)` task loop.
    *   **How it affects the system:** Gracefully halts execution if a sprint exhausts its `maxCycles` limit and fails, preventing the system from infinitely looping on the same failing task and rapidly exhausting API tokens and wallets.
*   **Execution Security Fix:**
    *   **Where:** `src/index.ts`
    *   **What changed:** Removed the `spawnSync` auto-execution of the `.omniloop/init.sh` script generated by the Planner. Replaced it with a CLI warning that alerts the user to manually review and execute the script.
    *   **How it affects the system:** Mitigates a critical remote code execution (RCE) and indirect prompt injection vulnerability. Malicious input (e.g., from an open GitHub issue) can no longer force the agent to execute dangerous shell commands natively on the host machine.

**Code Implementation:**

```typescript
// src/Workspace.ts - Adding the progress journal state
  public readonly progressFile: string;
  // ...
  this.progressFile = path.join(this.omniloopDir, 'omniloop-progress.txt');

// src/ContextSynthesizer.ts - State persistence handoff
  const progressFilePath = path.join('.omniloop', 'omniloop-progress.txt');
  if (fs.existsSync(progressFilePath)) {
    const progress = fs.readFileSync(progressFilePath, 'utf-8').trim();
    if (progress) {
      context += `\n### OMNILOOP PROGRESS LOG ###\nThe living log of what has been done previously:\n${progress}\n\n`;
      console.log('[+] Injected Progress Journal.');
    }
  }

// src/SprintOrchestrator.ts - Context Compaction Fix
  const truncatedFeedback = feedback.length > 5000 ? '...[TRUNCATED TO PREVENT EXHAUSTION]...\n' + feedback.substring(feedback.length - 5000) : feedback;

// src/SprintOrchestrator.ts - Evaluator Self-Verification Skew Fix (Fresh Context)
  const evaluatorContext = contextSynthesizer.getSurgicalContext(feature);
  const evaluatorPromptArgs = {
    ...promptArgs,
    CONTEXT: evaluatorContext,
    FEEDBACK: 'No previous feedback.'
  };

// src/index.ts - Infinite Hallucination Loop Fix
  const success = await orchestrator.runSprint(currentFeature);
  if (!success) {
    console.log(`\n[-] Sprint failed for feature ${currentFeature.id}. Exiting loop to prevent infinite retry exhaustion.`);
    break;
  }

// src/index.ts - Execution Security Fix
  if (fs.existsSync(workspace.sprintInitFile)) {
    console.log('\n[!] SECURITY WARNING: The Planner generated an `init.sh` script to scaffold the project.');
    console.log(`[!] To prevent arbitrary code execution, OmniLoop will NOT execute this automatically.`);
    console.log(`[!] Please review the script at ${workspace.sprintInitFile} and run it manually if trusted.`);
  }
```