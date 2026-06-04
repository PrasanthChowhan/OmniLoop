#!/usr/bin/env node

import * as path from 'path';
import * as fs from 'fs';

import { JsonBlueprintRepository, Feature } from './BlueprintRepository';
import { CliAgentRunner } from './AgentRunner';
import { SprintOrchestrator, SprintDependencies } from './SprintOrchestrator';
import { Workspace } from './Workspace';
import { GitVcs } from './Vcs';
import { ContextSynthesizer } from './ContextSynthesizer';
import { GitHubFeatureSource, FileSystemFeatureSource, FeatureSource } from './FeatureSource';

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

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--resume-from-commit') {
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
    } else if (!args[i].startsWith('--')) {
      goal = args[i];
    }
  }

  const workspace = new Workspace();
  const vcs = new GitVcs();
  const blueprint = new JsonBlueprintRepository(workspace.blueprintFile);
  const contextSynthesizer = new ContextSynthesizer(vcs, workspace.humanAdviceFile, globalCustomContextPath);
  
  const agentRunner = new CliAgentRunner(
    PROMPTS_DIR, 
    useDocker, 
    workspace.recordMetric.bind(workspace), 
    workspace.logTrace.bind(workspace)
  );

  let featureSource: FeatureSource;
  if (useGithub) {
    featureSource = new GitHubFeatureSource(vcs);
  } else {
    featureSource = new FileSystemFeatureSource(tasksPath || '', workspace);
  }

  if (commitHash) {
    console.log(`[*] Checking out commit ${commitHash}...`);
    vcs.runGitCommand(['checkout', commitHash]);
  }

  if (retryFeatureId) {
    blueprint.rollbackFeature(retryFeatureId);
    vcs.commitDurableState(`Rollback to retry feature ${retryFeatureId}`, [workspace.blueprintFile]);
  }

  // Handle tasks workflow or planner workflow
  if (useGithub || tasksPath) {
    if (fs.existsSync(workspace.blueprintFile) && !forceOverwrite) {
      console.error('[-] blueprint.json already exists! Aborting to prevent overwrite. Use --force to overwrite.');
      process.exit(1);
    }
    const features = await featureSource.fetchFeatures(forceOverwrite);
    blueprint.saveFeatures(features);
    vcs.commitDurableState(`Generated blueprint.json from ${useGithub ? 'GitHub' : tasksPath}`, [workspace.blueprintFile]);
    console.log(`[+] Generated ${features.length} features.`);
  } else if (!fs.existsSync(workspace.blueprintFile)) {
    if (!goal) {
      console.log('[-] No blueprint.json found. You must provide a goal or use --tasks.');
      process.exit(1);
    }

    console.log('[*] Running Planner...');
    agentRunner.runAgent('planner', { contextStr: '' }, { goal, featureId: 'init', cycle: 0 });

    if (!fs.existsSync(workspace.blueprintFile)) {
      console.log('[-] Planner failed. Exiting.');
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
    const recentFiles = vcs.runGitCommand(['diff', 'main', '--name-only']).split('\n');
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
    if (!target || !fs.existsSync(target)) return;
    vcs.runGitCommand(['checkout', '--', target]);
  }

  const sprintDeps: SprintDependencies = {
    blueprint,
    agentRunner,
    workspace,
    vcs,
    contextSynthesizer,
    featureSource,
    maxCycles: MAX_CYCLES,
    skipTest,
    injectBug,
    revertBug
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
