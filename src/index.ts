#!/usr/bin/env node

import * as path from 'path';
import * as fs from 'fs';

import { JsonBlueprintRepository } from './state/BlueprintRepository';
import { CliAgentRunner } from './core/AgentRunner';
import { SprintOrchestrator, SprintDependencies } from './core/SprintOrchestrator';
import { Workspace } from './state/Workspace';
import { GitVcs } from './vcs/Vcs';
import { ContextSynthesizer } from './state/ContextSynthesizer';
import { parseArgs } from './cli/args';
import { PlannerOrchestrator } from './core/PlannerOrchestrator';
import { Logger } from './utils/logger';

const SCRIPT_DIR = path.resolve(__dirname, '..');
const PROMPTS_DIR = path.join(SCRIPT_DIR, '.omniloop');
const MAX_CYCLES = 3;

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const workspace = new Workspace();
  const vcs = new GitVcs();
  const blueprint = new JsonBlueprintRepository(workspace.blueprintFile);
  const contextSynthesizer = new ContextSynthesizer(vcs, workspace.humanAdviceFile, options.globalCustomContextPath);
  
  const actualPromptsDir = options.mode === 'ralph' ? path.join(PROMPTS_DIR, 'ralph') : PROMPTS_DIR;
  const agentRunner = new CliAgentRunner(
    actualPromptsDir, 
    options.useDocker,
    workspace.recordMetric.bind(workspace), 
    workspace.logTrace.bind(workspace)
  );

  if (options.commitHash) {
    Logger.info(`Checking out commit ${options.commitHash}...`);
    vcs.checkoutCommit(options.commitHash);
  }

  if (options.retryFeatureId) {
    blueprint.rollbackFeature(options.retryFeatureId);
    vcs.commitDurableState(`Rollback to retry feature ${options.retryFeatureId}`, [workspace.blueprintFile]);
  }

  if (!workspace.hasBlueprintFile()) {
    const planner = new PlannerOrchestrator(agentRunner, blueprint, workspace, vcs);
    await planner.runPlanner(options.goal, options.useGithub, options.tasksPath);
  }

  function injectBug(): string | null {
    const recentFiles = vcs.getChangedFilesFromBase();
    let target = null;
    for (const f of recentFiles) {
      if (f && fs.existsSync(f) && (f.endsWith('.py') || f.endsWith('.js') || f.endsWith('.ts') || f.endsWith('.html') || f.endsWith('.css'))) {
        target = f;
        break;
      }
    }

    if (!target) return null;

    fs.appendFileSync(target, '\n\n!!! HARNESS_INJECTED_SYNTAX_ERROR !!!\n', 'utf-8');
    return target;
  }

  function revertBug(target: string | null): void {
    vcs.discardUncommittedChanges();
  }

  const sprintDeps: SprintDependencies = {
    blueprint,
    agentRunner,
    workspace,
    vcs,
    contextSynthesizer,
    maxCycles: MAX_CYCLES,
    skipTest: options.skipTest,
    injectBug,
    revertBug,
    mode: options.mode
  };

  const orchestrator = new SprintOrchestrator(sprintDeps);

  try {
    while (true) {
      const currentFeature = blueprint.getNextIncompleteFeature();

      if (!currentFeature) {
        Logger.success('All features passing! Project complete.');
        break;
      }

      const success = await orchestrator.runSprint(currentFeature);

      if (!success) {
        Logger.error(`Sprint failed for feature ${currentFeature.id}. Exiting loop to prevent infinite retry exhaustion.`);
        break;
      }
    }
  } catch (err: any) {
    Logger.warn("OmniLoop paused by user. Use .omniloop/human_advice.md to steer the agent on resume.");
    process.exit(0);
  }
}

let isShuttingDown = false;
function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[!] Received ${signal}. Cleaning up state and exiting...`);

  try {
    const omniloopDir = path.join(process.cwd(), '.omniloop');
    if (fs.existsSync(omniloopDir)) {
      const files = fs.readdirSync(omniloopDir);
      for (const f of files) {
        if (f.startsWith('temp_') && f.endsWith('_prompt.txt')) {
          try {
            fs.unlinkSync(path.join(omniloopDir, f));
          } catch {}
        }
      }
    }
  } catch {}

  process.exit(130);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

main();
