#!/usr/bin/env node

import * as path from 'path';
import * as fs from 'fs';

import { JsonBlueprintRepository, Feature } from './BlueprintRepository';
import { CliAgentRunner } from './AgentRunner';
import { SprintOrchestrator, SprintDependencies } from './SprintOrchestrator';
import { Workspace } from './Workspace';
import { GitVcs } from './Vcs';
import { ContextSynthesizer } from './ContextSynthesizer';
import { extractXmlTag } from './StructuredOutput';

const SCRIPT_DIR = path.resolve(__dirname, '..');
const PROMPTS_DIR = path.join(SCRIPT_DIR, '.omniloop');
const MAX_CYCLES = 3;

async function main() {
  const args = process.argv.slice(2);
  let goal = '';
  let commitHash: string | null = null;
  let retryFeatureId: string | null = null;
  let useDocker = false;
  let skipTest = false;
  
  let tasksPath: string | null = null;
  let forceOverwrite = false;
  let useGithub = false;
  let globalCustomContextPath: string | null = null;
  let mode = 'omniloop';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
OmniLoop - A prompt-driven, work-agnostic orchestrator

Usage:
  omniloop [goal] [options]

Options:
  --help, -h                Show this help message
  --mode <mode>             Set the execution mode (e.g., 'ralph', 'omniloop')
  --github                  Fetch open GitHub issues and plan them
  --tasks <path>            Read task definitions from the specified folder/file
  --context <path>          Provide a custom context file
  --docker                  Run agents inside a Docker container
  --force                   Overwrite existing blueprint.json if present
  --no-test                 Skip the Evaluator verification phase
  --resume-from-commit <id> Checkout a specific commit before running
  --retry-feature <id>      Rollback and retry a specific feature ID

Examples:
  omniloop "Organize the codebase" --mode ralph
  omniloop --github --mode ralph
  omniloop --tasks ./backlog --mode ralph
      `);
      process.exit(0);
    } else if (args[i] === '--resume-from-commit') {
      commitHash = args[++i];
    } else if (args[i] === '--retry-feature') {
      retryFeatureId = args[++i];
    } else if (args[i] === '--docker') {
      useDocker = true;
    } else if (args[i] === '--github') {
      useGithub = true;
    } else if (args[i] === '--tasks') {
      tasksPath = args[++i];
    } else if (args[i] === '--context') {
      globalCustomContextPath = args[++i];
    } else if (args[i] === '--force') {
      forceOverwrite = true;
    } else if (args[i] === '--no-test') {
      skipTest = true;
    } else if (args[i] === '--mode') {
      mode = args[++i];
    } else if (!args[i].startsWith('--')) {
      goal = args[i];
    }
  }

  const workspace = new Workspace();
  const vcs = new GitVcs();
  const blueprint = new JsonBlueprintRepository(workspace.blueprintFile);
  const contextSynthesizer = new ContextSynthesizer(vcs, workspace.humanAdviceFile, globalCustomContextPath);
  
  const actualPromptsDir = mode === 'ralph' ? path.join(PROMPTS_DIR, 'ralph') : PROMPTS_DIR;
  const agentRunner = new CliAgentRunner(
    actualPromptsDir, 
    useDocker, 
    workspace.recordMetric.bind(workspace), 
    workspace.logTrace.bind(workspace)
  );

  if (commitHash) {
    console.log(`[*] Checking out commit ${commitHash}...`);
    vcs.checkoutCommit(commitHash);
  }

  if (retryFeatureId) {
    blueprint.rollbackFeature(retryFeatureId);
    vcs.commitDurableState(`Rollback to retry feature ${retryFeatureId}`, [workspace.blueprintFile]);
  }

  // Handle planner workflow
  if (!fs.existsSync(workspace.blueprintFile)) {
    if (!goal.trim() && !useGithub && !tasksPath) {
      console.log('[-] No blueprint.json found. You must provide a goal, --github, or --tasks.');
      process.exit(1);
    }

    let templateInjections = '';
    if (useGithub) {
      templateInjections += "\n<github-issues>\n!`gh issue list --state open --json number,title,body`\n</github-issues>\n";
    }
    if (tasksPath) {
      templateInjections += `\n<task-files>\n!\`cat ${tasksPath}/*.md || cat ${tasksPath}/*.txt || echo "No text files found in ${tasksPath}"\`\n</task-files>\n`;
    }

    console.log('[*] Running Planner...');
    const result = agentRunner.runAgent('planner', { contextStr: '' }, { 
      goal, 
      featureId: 'init', 
      cycle: 0, 
      promptArgs: { TASK_DESCRIPTION: goal },
      templateInjections
    });

    if (!result.success) {
      console.log('[-] Planner failed to execute. Exiting.');
      process.exit(1);
    }

    const planJsonStr = extractXmlTag(result.output, 'plan');
    if (!planJsonStr) {
      console.log('[-] Planner did not output a valid <plan> tag. Exiting.');
      console.log(`Raw output: ${result.output}`);
      process.exit(1);
    }
    
    try {
      const plan = JSON.parse(planJsonStr);
      if (plan.features && Array.isArray(plan.features)) {
        blueprint.saveFeatures(plan.features);
      } else {
        throw new Error('Invalid plan format: missing features array');
      }
    } catch (e: any) {
      console.log(`[-] Failed to parse planner output: ${e.message}`);
      process.exit(1);
    }

    workspace.recordMetric('planner_successes');
    vcs.commitDurableState('Initial feature spec generated', [workspace.blueprintFile]);

    if (fs.existsSync(workspace.sprintInitFile)) {
      console.log('[*] Executing init.sh to scaffold project...');
      try {
        const { spawnSync } = require('child_process');
        const initResult = spawnSync('bash', [workspace.sprintInitFile], { stdio: 'inherit', shell: true });
        if (initResult.status !== 0) {
          console.warn(`[!] Warning: init.sh exited with code ${initResult.status}`);
        } else {
          console.log('[+] Project scaffolded successfully.');
          vcs.commitDurableState('Project scaffolded via init.sh', []);
        }
      } catch (e: any) {
        console.error(`[-] Failed to execute init.sh: ${e.message}`);
      }
    }
    
    console.log('\n[!] blueprint.json generated. The process will continue automatically in 5 seconds (or press Ctrl+C to abort and review).');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
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
    skipTest,
    injectBug,
    revertBug,
    mode
  };

  const orchestrator = new SprintOrchestrator(sprintDeps);

  try {
    while (true) {
      const currentFeature = blueprint.getNextIncompleteFeature();

      if (!currentFeature) {
        console.log('\n[+] All features passing! Project complete.');
        break;
      }

      const success = await orchestrator.runSprint(currentFeature);
    }
  } catch (err: any) {
    console.log("\n\n[!] OmniLoop paused by user. Use human_advice.md to steer the agent on resume.");
    process.exit(0);
  }
}

main();
