#!/usr/bin/env node

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execSync, spawnSync } from 'child_process';

const SCRIPT_DIR = path.resolve(__dirname, '..');
const PROMPTS_DIR = path.join(SCRIPT_DIR, '.harness');

const HARNESS_DIR = '.harness';
const TRACES_FILE = path.join(HARNESS_DIR, 'harness_traces.jsonl');
const METRICS_FILE = path.join(HARNESS_DIR, 'metrics.json');
const FEATURE_LIST_FILE = path.join(HARNESS_DIR, 'feature_list.json');
const SPRINT_CONTRACT = path.join(HARNESS_DIR, 'sprint_contract.md');
const FEEDBACK_FILE = path.join(HARNESS_DIR, 'sprint_feedback.md');
const HUMAN_ADVICE_FILE = path.join(HARNESS_DIR, 'human_advice.md');
const CONTRACT_APPROVED_FILE = path.join(HARNESS_DIR, 'contract_approved.txt');
const MAX_ITERATIONS = 3;

// Ensure harness dir exists locally
if (!fs.existsSync(HARNESS_DIR)) {
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
}

let globalCustomContextPath: string | null = null;

// -----------------
// UTILS & METRICS
// -----------------
function loadJson(filepath: string, defaultVal: any = null): any {
  if (!fs.existsSync(filepath)) {
    return defaultVal || {};
  }
  try {
    const data = fs.readFileSync(filepath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return defaultVal || {};
  }
}

function saveJson(filepath: string, data: any): void {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

function recordMetric(key: string, increment: number = 1): void {
  const metrics = loadJson(METRICS_FILE);
  metrics[key] = (metrics[key] || 0) + increment;
  saveJson(METRICS_FILE, metrics);
}

function logTrace(featureId: string, agentName: string, iteration: number, stdout: string, stderr: string): void {
  const trace = {
    timestamp: new Date().toISOString(),
    feature_id: featureId,
    agent_type: agentName,
    iteration_number: iteration,
    stdout,
    stderr,
    metadata: {
      model_version: 'unknown',
      tokens: 0
    }
  };
  fs.appendFileSync(TRACES_FILE, JSON.stringify(trace) + '\n', 'utf-8');
}

// -----------------
// GIT MANAGEMENT
// -----------------
function runGitCommand(args: string[]): string {
  try {
    const result = execSync(`git ${args.join(' ')}`, { encoding: 'utf-8', stdio: 'pipe' });
    return result.trim();
  } catch (error: any) {
    console.error(`[!] Git error: ${error.stderr?.trim() || error.message}`);
    return '';
  }
}

function checkoutFeatureBranch(featureId: string): void {
  const branchName = `feature_${featureId}`;
  const current = runGitCommand(['branch', '--show-current']);
  if (current === branchName) return;

  const branches = runGitCommand(['branch', '--list', branchName]);
  if (branches.includes(branchName)) {
    runGitCommand(['checkout', branchName]);
  } else {
    runGitCommand(['checkout', '-b', branchName]);
  }
}

function mergeFeatureBranch(featureId: string): void {
  const branchName = `feature_${featureId}`;
  
  // Auto-commit any lingering files the Generator forgot to commit
  runGitCommand(['add', '-A']);
  runGitCommand(['commit', '-m', `"Auto-commit generated code for feature ${featureId}"`]);

  runGitCommand(['checkout', 'main']);
  runGitCommand(['merge', '--no-ff', branchName, '-m', `"Merge feature ${featureId}"`]);
  runGitCommand(['branch', '-d', branchName]);
}

function commitDurableState(message: string): void {
  runGitCommand(['add', FEATURE_LIST_FILE]);
  runGitCommand(['commit', '-m', `"${message}"`]);
}

// -----------------
// TASK GENERATOR
// -----------------
function generateFeatureListFromTasks(tasksPath: string): void {
  console.log(`[*] Generating feature_list.json from custom tasks at ${tasksPath}...`);
  let features: any[] = [];
  
  if (!fs.existsSync(tasksPath)) {
    console.error(`[-] Tasks path ${tasksPath} does not exist.`);
    process.exit(1);
  }

  const stat = fs.statSync(tasksPath);
  if (stat.isDirectory()) {
    const files = fs.readdirSync(tasksPath).filter(f => f.endsWith('.md') || f.endsWith('.txt')).sort();
    files.forEach((file, index) => {
      const content = fs.readFileSync(path.join(tasksPath, file), 'utf-8');
      features.push({
        id: (index + 1).toString(),
        description: `Task from ${file}:\n${content.trim()}`,
        passes: false
      });
    });
  } else if (stat.isFile()) {
    const data = loadJson(tasksPath);
    if (Array.isArray(data)) {
      data.forEach((item, index) => {
        if (typeof item === 'string') {
          features.push({ id: (index + 1).toString(), description: item, passes: false });
        } else if (typeof item === 'object') {
          features.push({
            id: item.id || (index + 1).toString(),
            description: item.description || JSON.stringify(item),
            passes: false
          });
        }
      });
    } else if (data.features && Array.isArray(data.features)) {
      features = data.features.map((f: any, i: number) => ({
        id: f.id || (i + 1).toString(),
        description: f.description || '',
        passes: false
      }));
    } else {
      console.error(`[-] Unrecognized JSON format in ${tasksPath}. Expected an array or { features: [] }.`);
      process.exit(1);
    }
  }

  saveJson(FEATURE_LIST_FILE, { features });
  console.log(`[+] Generated ${features.length} features.`);
}

// -----------------
// CONTEXT & INJECTION
// -----------------
function getSurgicalContext(feature: any): string {
  let context = '';

  // 1. Inject Global/Project Context
  const projectContextPaths = ['context.md', 'AGENTS.md', '.agents', '.gemini', '.claude'];
  for (const cPath of projectContextPaths) {
    if (fs.existsSync(cPath)) {
      const stat = fs.statSync(cPath);
      if (stat.isFile()) {
        console.log(`[+] Injecting project context from ${cPath}`);
        context += `### PROJECT CONTEXT (${cPath}) ###\n${fs.readFileSync(cPath, 'utf-8')}\n\n`;
      } else if (stat.isDirectory()) {
        try {
          const files = fs.readdirSync(cPath, { recursive: true });
          for (const file of files) {
            const fullPath = path.join(cPath, file.toString());
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile() && (fullPath.endsWith('.md') || fullPath.endsWith('.txt'))) {
              console.log(`[+] Injecting project context from ${fullPath}`);
              context += `### PROJECT CONTEXT (${fullPath}) ###\n${fs.readFileSync(fullPath, 'utf-8')}\n\n`;
            }
          }
        } catch (e) {
          console.error(`[-] Could not read directory ${cPath}`, e);
        }
      }
    }
  }

  // 2. Inject Custom Context from CLI
  if (globalCustomContextPath && fs.existsSync(globalCustomContextPath)) {
    const stat = fs.statSync(globalCustomContextPath);
    if (stat.isFile()) {
      console.log(`[+] Injecting custom context from ${globalCustomContextPath}`);
      context += `### ADDITIONAL CONTEXT ###\n${fs.readFileSync(globalCustomContextPath, 'utf-8')}\n\n`;
    }
  }

  context += `Target Feature:\n${JSON.stringify(feature, null, 2)}\n\n`;

  // CTAGS check
  let hasCtags = false;
  try {
    execSync('ctags --version', { stdio: 'ignore' });
    hasCtags = true;
  } catch {
    hasCtags = false;
  }

  if (hasCtags) {
    const recentFiles = runGitCommand(['diff', 'main', '--name-only']).split('\n');
    let tagsOut = '';
    for (const rf of recentFiles) {
      if (rf && fs.existsSync(rf) && (rf.endsWith('.py') || rf.endsWith('.js') || rf.endsWith('.ts'))) {
        try {
          const res = execSync(`ctags -x ${rf}`, { encoding: 'utf-8' });
          tagsOut += res + '\n';
        } catch {}
      }
    }
    if (tagsOut) {
      context += `Relevant Symbols (CTAGS):\n${tagsOut}\n\n`;
    }
  } else {
    const recentCommits = runGitCommand(['log', '--oneline', '-n', '3']);
    if (recentCommits) {
      context += `Recent Git History:\n${recentCommits}\n\n`;
    }
    const diff = runGitCommand(['diff', 'main']);
    if (diff) {
      context += `Changes in this feature branch:\n${diff}\n\n`;
    }
  }

  // Human Advice Side-Channel
  if (fs.existsSync(HUMAN_ADVICE_FILE)) {
    const advice = fs.readFileSync(HUMAN_ADVICE_FILE, 'utf-8').trim();
    if (advice) {
      context += `\n### HUMAN ADVICE ###\nThe human user has provided the following mid-sprint direction. You MUST follow it:\n${advice}\n\n`;
      console.log('[+] Injected Human Advice side-channel.');
      fs.writeFileSync(HUMAN_ADVICE_FILE, '', 'utf-8');
    }
  }

  return context;
}

// -----------------
// CHAOS TESTING
// -----------------
function injectBug(): string | null {
  const recentFiles = runGitCommand(['diff', 'main', '--name-only']).split('\n');
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
  runGitCommand(['checkout', '--', target]);
}

// -----------------
// AGENT RUNNER
// -----------------
function runAgent(promptFile: string, contextStr: string, goal: string, useDocker: boolean = false, featureId: string = 'init', iteration: number = 0): boolean {
  const systemPrompt = fs.readFileSync(path.join(PROMPTS_DIR, promptFile), 'utf-8');
  
  // Goal might be optional now, so we only include it if it exists
  let message = '';
  if (goal) message += `${goal}\n\n`;
  message += `--- Context ---\n${contextStr}\n`;

  const agentName = promptFile.split('_')[0];

  console.log(`\n[+] Running ${agentName.charAt(0).toUpperCase() + agentName.slice(1)} Agent...`);

  let fullCmd = '';
  if (useDocker) {
    fullCmd = `docker run --rm -v "${process.cwd()}:/app" -w /app gemini`;
  } else {
    // Windows fallback handled by shell execution
    fullCmd = 'npx @google/gemini-cli --skip-trust -y --prompt -';
  }

  const fullPrompt = `CRITICAL META-INSTRUCTION: You are an autonomous agent executing a workflow. DO NOT review, analyze, or edit the prompt text itself. You MUST execute the instructions within the prompt using your tools immediately.\n\n=== SYSTEM PROMPT ===\n${systemPrompt}\n\n=== CURRENT TASK ===\n${message}`;

  recordMetric(`${agentName}_attempts`);
  try {
    const result = spawnSync(fullCmd, {
      shell: true,
      input: fullPrompt,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    logTrace(featureId, agentName, iteration, result.stdout, result.stderr);

    if (result.status !== 0) {
      console.log(`[-] Error running agent: Process exited with code ${result.status}`);
      return false;
    }

    return true;
  } catch (e: any) {
    console.log(`[-] Error running agent: ${e.message}`);
    logTrace(featureId, `${agentName}_ERROR`, iteration, '', e.message);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000); // sleep 2s
    return false;
  }
}

// -----------------
// MAIN LOOP
// -----------------
function main() {
  const args = process.argv.slice(2);
  let goal = '';
  let commitHash = null;
  let retryFeatureId = null;
  let useDocker = false;
  let skipTest = false;
  
  // New workflow arguments
  let tasksPath: string | null = null;
  let forceOverwrite = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--resume-from-commit') {
      commitHash = args[++i];
    } else if (args[i] === '--retry-feature') {
      retryFeatureId = args[++i];
    } else if (args[i] === '--docker') {
      useDocker = true;
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

  if (commitHash) {
    console.log(`[*] Checking out commit ${commitHash}...`);
    runGitCommand(['checkout', commitHash]);
  }

  if (retryFeatureId) {
    const features = loadJson(FEATURE_LIST_FILE, { features: [] });
    let found = false;
    for (const f of features.features || []) {
      if (String(f.id) === String(retryFeatureId)) {
        found = true;
      }
      if (found) {
        f.passes = false;
      }
    }
    saveJson(FEATURE_LIST_FILE, features);
    commitDurableState(`Rollback to retry feature ${retryFeatureId}`);
  }

  // Handle tasks workflow or planner workflow
  if (tasksPath) {
    if (fs.existsSync(FEATURE_LIST_FILE) && !forceOverwrite) {
      console.error('[-] feature_list.json already exists! Aborting to prevent overwrite. Use --force to overwrite.');
      process.exit(1);
    }
    generateFeatureListFromTasks(tasksPath);
    commitDurableState('Generated feature_list.json from custom tasks');
  } else if (!fs.existsSync(FEATURE_LIST_FILE)) {
    if (!goal) {
      console.log('[-] No feature_list.json found. You must provide a goal or use --tasks.');
      process.exit(1);
    }

    console.log('[*] Running Planner...');
    runAgent('planner_prompt.md', '', goal, useDocker);

    if (!fs.existsSync(FEATURE_LIST_FILE)) {
      console.log('[-] Planner failed. Exiting.');
      process.exit(1);
    }

    recordMetric('planner_successes');
    commitDurableState('Initial feature spec generated');
    
    console.log('\n[!] feature_list.json generated. The process will continue automatically in 5 seconds (or press Ctrl+C to abort and review).');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
  }

  try {
    while (true) {
      const features = loadJson(FEATURE_LIST_FILE);
      const currentFeature = (features.features || []).find((f: any) => !f.passes);

      if (!currentFeature) {
        console.log('\n[+] All features passing! Project complete.');
        break;
      }

      const featureId = currentFeature.id || 'unknown';
      console.log(`\n[*] ----------------------------------------------------`);
      console.log(`[*] Sprint: [${featureId}] ${currentFeature.description}`);
      console.log(`[*] ----------------------------------------------------`);

      checkoutFeatureBranch(featureId);

      // --- Phase 1: Contract Negotiation ---
      let contractApproved = false;
      let contractIteration = 0;
      
      while (contractIteration < MAX_ITERATIONS && !contractApproved) {
        contractIteration++;
        console.log(`\n[*] --- Contract Iteration ${contractIteration}/${MAX_ITERATIONS} ---`);
        let contractContext = getSurgicalContext(currentFeature);
        if (fs.existsSync(FEEDBACK_FILE)) {
          contractContext += `\nContract Feedback:\n${fs.readFileSync(FEEDBACK_FILE, 'utf-8')}\n`;
        }

        console.log('[*] Running Contractor...');
        runAgent('contractor_prompt.md', contractContext, `Create a contract for: ${currentFeature.description}`, useDocker, featureId, contractIteration);

        console.log('[*] Running Contract Evaluator...');
        runAgent('contract_evaluator_prompt.md', contractContext, `Review the contract for: ${currentFeature.description}`, useDocker, featureId, contractIteration);

        if (fs.existsSync(CONTRACT_APPROVED_FILE)) {
          console.log('[+] Contract approved!');
          contractApproved = true;
          fs.unlinkSync(CONTRACT_APPROVED_FILE);
          if (fs.existsSync(FEEDBACK_FILE)) fs.unlinkSync(FEEDBACK_FILE);
        } else {
          console.log(`[-] Contract rejected or missing approval. Retrying...`);
        }
      }

      if (!contractApproved) {
        console.log(`\n[!] WARNING: Feature [${featureId}] failed to negotiate a contract after ${MAX_ITERATIONS} iterations.`);
        console.log(`[!] Check \`human_advice.md\`. Resuming automatically in 5 seconds (Ctrl+C to abort) ...`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
        continue;
      }

      // --- Phase 2: Implementation ---
      let iteration = 0;
      let featurePassed = false;
      while (iteration < MAX_ITERATIONS) {
        iteration++;
        console.log(`\n[*] --- Implementation Iteration ${iteration}/${MAX_ITERATIONS} ---`);

        let context = getSurgicalContext(currentFeature);
        if (fs.existsSync(SPRINT_CONTRACT)) {
          context += `\nApproved Sprint Contract:\n${fs.readFileSync(SPRINT_CONTRACT, 'utf-8')}\n`;
        }
        if (fs.existsSync(FEEDBACK_FILE)) {
          context += `\nEvaluator Feedback:\n${fs.readFileSync(FEEDBACK_FILE, 'utf-8')}\n`;
        }

        console.log('[*] Running Generator...');
        const success = runAgent('generator_prompt.md', context, `Focus on this feature: ${currentFeature.description}`, useDocker, featureId, iteration);
        if (success) recordMetric('generator_successes');

        if (skipTest) {
          console.log(`[+] Skipping evaluation phase for Feature [${featureId}] due to --no-test flag.`);
          const currentFeatures = loadJson(FEATURE_LIST_FILE);
          const updatedFeature = (currentFeatures.features || []).find((f: any) => String(f.id) === String(featureId));
          if (updatedFeature) {
             updatedFeature.passes = true;
             saveJson(FEATURE_LIST_FILE, currentFeatures);
          }
          if (fs.existsSync(FEEDBACK_FILE)) fs.unlinkSync(FEEDBACK_FILE);

          mergeFeatureBranch(featureId);
          commitDurableState(`Feature ${featureId} completed and merged (no-test mode)`);
          featurePassed = true;
          break;
        }

        if (iteration === 1) {
          console.log('[*] Performing Meta-Evaluation Chaos Test...');
          const bugFile = injectBug();
          if (bugFile) {
            runAgent('evaluator_prompt.md', context, `Evaluate this feature: ${currentFeature.description}`, useDocker, featureId, iteration);
            const featuresPostChaos = loadJson(FEATURE_LIST_FILE);
            const postChaosFeat = (featuresPostChaos.features || []).find((f: any) => String(f.id) === String(featureId));

            if (postChaosFeat && postChaosFeat.passes) {
              console.log("[-] Evaluator FAILED Meta-Evaluation! It passed a broken build.");
              recordMetric("evaluator_chaos_fails");
              fs.writeFileSync(FEEDBACK_FILE, "META-EVALUATION FAILED: You marked a build as 'passes: true' even though it contained a blatant syntax error. Your tests are fake or broken. Fix your testing strategy.", 'utf-8');
              
              postChaosFeat.passes = false;
              saveJson(FEATURE_LIST_FILE, featuresPostChaos);
            } else {
              console.log("[+] Evaluator caught the chaos bug successfully.");
              recordMetric("evaluator_chaos_successes");
              if (fs.existsSync(FEEDBACK_FILE)) fs.unlinkSync(FEEDBACK_FILE);
            }

            revertBug(bugFile);

            if (postChaosFeat && postChaosFeat.passes) {
              continue; // Restart iteration
            }
          }
        }

        console.log('[*] Running Evaluator (Real)...');
        runAgent('evaluator_prompt.md', context, `Evaluate this feature: ${currentFeature.description}`, useDocker, featureId, iteration);

        const currentFeatures = loadJson(FEATURE_LIST_FILE);
        const updatedFeature = (currentFeatures.features || []).find((f: any) => String(f.id) === String(featureId));

        if (updatedFeature && updatedFeature.passes) {
          console.log(`[+] Feature [${featureId}] passed evaluation!`);
          recordMetric('evaluator_successes');
          if (fs.existsSync(FEEDBACK_FILE)) fs.unlinkSync(FEEDBACK_FILE);

          mergeFeatureBranch(featureId);
          commitDurableState(`Feature ${featureId} completed and merged`);
          featurePassed = true;
          break;
        } else {
          console.log(`[-] Feature [${featureId}] failed evaluation. Retrying...`);
        }
      }

      if (!featurePassed && iteration >= MAX_ITERATIONS) {
        console.log(`\n[!] WARNING: Feature [${featureId}] failed to pass after ${MAX_ITERATIONS} iterations.`);
        console.log(`[!] Check \`human_advice.md\`. Resuming automatically in 5 seconds (Ctrl+C to abort) ...`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
      }
    }
  } catch (err: any) {
    console.log("\n\n[!] Harness paused by user. Use human_advice.md to steer the agent on resume.");
    process.exit(0);
  }
}

main();
