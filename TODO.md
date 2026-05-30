# Future Enhancements TODO

## 1. Implement "Lightweight/Fast" Mode
* **Goal**: Adapt the harness for simpler, everyday tasks that don't require the full rigorous QA and contract negotiation pipeline, while still keeping the incremental Sprint-based workflow intact.
* **CLI Flag**: Introduce a flag like `--lite`, `--fast`, or `--no-strict`.

## 2. Bypass Contract Negotiation
* In lightweight mode, skip the Contractor and Reviewer agents.
* The Generator agent will take the sprint specs directly from `blueprint.json` without needing a pre-approved `.harness/sprint_contract.md`.

## 3. Bypass Rigorous Testing & Chaos Injection
* In lightweight mode, skip the Evaluator agent entirely, or replace it with a simple, lenient sanity checker.
* Disable the "Chaos Test" (syntax bug injection) as it slows down simple cycles.
* Allow the Generator to directly mark features as `passes: true` once it successfully compiles or finishes its work.

## 4. Retain the Sprint Loop (Incremental Progress)
* Keep the core of the workflow: working on one feature at a time from `blueprint.json`.
* Maintain the VCS branching, committing, and `claude-progress.txt` updating so that state is still durable and tracked.

## 5. Adjust CLI & `index.ts` Logic
* Modify the main loop in `src/index.ts` to conditionally bypass phases 1 (Contract) and 2 (Evaluation) if the lightweight flag is active.
