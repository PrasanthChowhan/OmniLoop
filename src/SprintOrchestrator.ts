import * as fs from 'fs';
import { Feature, BlueprintRepository } from './BlueprintRepository';
import { AgentRunner } from './AgentRunner';
import { Workspace } from './Workspace';
import { Vcs } from './Vcs';
import { ContextSynthesizer } from './ContextSynthesizer';

export interface SprintDependencies {
  blueprint: BlueprintRepository;
  agentRunner: AgentRunner;
  workspace: Workspace;
  vcs: Vcs;
  contextSynthesizer: ContextSynthesizer;
  maxCycles: number;
  skipTest: boolean;
  injectBug: () => string | null;
  revertBug: (target: string | null) => void;
  mode: string;
}

export class SprintOrchestrator {
  constructor(private deps: SprintDependencies) {}

  async runSprint(feature: Feature): Promise<boolean> {
    const {
      blueprint, agentRunner, workspace, vcs, contextSynthesizer,
      maxCycles, skipTest, injectBug, revertBug
    } = this.deps;

    const featureId = feature.id || 'unknown';
    console.log(`\n[*] ----------------------------------------------------`);
    console.log(`[*] Sprint: [${featureId}] ${feature.description}`);
    console.log(`[*] ----------------------------------------------------`);

    if (this.deps.mode !== 'ralph') {
      vcs.checkoutFeatureBranch(featureId);
    } else {
      console.log(`[*] Ralph Mode: Operating on current branch (Work Agnostic).`);
    }

    // --- Phase 1: Contract Negotiation ---
    let contractApproved = false;
    let contractCycle = 0;
    
    if (this.deps.mode === 'ralph') {
      console.log('\n[*] Ralph Mode selected. Skipping Contract Negotiation (Phase 1).');
      contractApproved = true;
    } else {
      while (contractCycle < maxCycles && !contractApproved) {
        contractCycle++;
      console.log(`\n[*] --- Contract Cycle ${contractCycle}/${maxCycles} ---`);
      let contractContext = contextSynthesizer.getSurgicalContext(feature);
      if (fs.existsSync(workspace.feedbackFile)) {
        const feedback = fs.readFileSync(workspace.feedbackFile, 'utf-8');
        const truncatedFeedback = feedback.length > 5000 ? '...[TRUNCATED TO PREVENT EXHAUSTION]...\n' + feedback.substring(feedback.length - 5000) : feedback;
        contractContext += `\nContract Feedback:\n${truncatedFeedback}\n`;
      }

      console.log('[*] Running Contractor...');
      agentRunner.runAgent(
        'contractor',
        { contextStr: contractContext },
        { goal: `Create a contract for: ${feature.description}`, featureId, cycle: contractCycle }
      );

      console.log('[*] Running Reviewer...');
      agentRunner.runAgent(
        'reviewer',
        { contextStr: contractContext },
        { goal: `Review the contract for: ${feature.description}`, featureId, cycle: contractCycle }
      );

      if (fs.existsSync(workspace.contractApprovedFile)) {
        console.log('[+] Contract approved!');
        contractApproved = true;
        fs.unlinkSync(workspace.contractApprovedFile);
        if (fs.existsSync(workspace.feedbackFile)) fs.unlinkSync(workspace.feedbackFile);
      } else {
        console.log(`[-] Contract rejected or missing approval. Retrying...`);
      }
    }

    if (!contractApproved) {
      console.log(`\n[!] WARNING: Feature [${featureId}] failed to negotiate a contract after ${maxCycles} cycles.`);
      console.log(`[!] Check \`human_advice.md\`. Resuming automatically in 5 seconds (Ctrl+C to abort) ...`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
      return false;
    }
    }

    // --- Phase 2: Implementation ---
    let cycle = 0;
    let featurePassed = false;
    while (cycle < maxCycles) {
      cycle++;
      console.log(`\n[*] --- Implementation Cycle ${cycle}/${maxCycles} ---`);

      let generatorContext = contextSynthesizer.getSurgicalContext(feature);
      if (fs.existsSync(workspace.sprintContractFile)) {
        const contract = fs.readFileSync(workspace.sprintContractFile, 'utf-8');
        const truncatedContract = contract.length > 8000 ? '...[TRUNCATED TO PREVENT EXHAUSTION]...\n' + contract.substring(contract.length - 8000) : contract;
        generatorContext += `\nApproved Sprint Contract:\n${truncatedContract}\n`;
      }
      if (fs.existsSync(workspace.feedbackFile)) {
        const feedback = fs.readFileSync(workspace.feedbackFile, 'utf-8');
        const truncatedFeedback = feedback.length > 5000 ? '...[TRUNCATED TO PREVENT EXHAUSTION]...\n' + feedback.substring(feedback.length - 5000) : feedback;
        generatorContext += `\nEvaluator Feedback:\n${truncatedFeedback}\n`;
      }

      const promptArgs = {
        TASK_DESCRIPTION: feature.description,
        CUSTOM_SYSTEM_PROMPT: feature.customSystemPrompt || '',
        CONTEXT: generatorContext,
        FEEDBACK: fs.existsSync(workspace.feedbackFile) ? fs.readFileSync(workspace.feedbackFile, 'utf-8') : 'No previous feedback.'
      };

      console.log('[*] Running Generator...');
      const success = agentRunner.runAgent(
        'generator',
        { contextStr: generatorContext },
        { goal: `Focus on this feature: ${feature.description}`, featureId, cycle, promptArgs }
      );
      if (success) workspace.recordMetric('generator_successes');

      if (skipTest) {
        console.log(`[+] Skipping evaluation phase for Feature [${featureId}] due to --no-test flag.`);
        blueprint.markFeaturePassed(featureId);
        if (fs.existsSync(workspace.feedbackFile)) fs.unlinkSync(workspace.feedbackFile);

        if (this.deps.mode !== 'ralph') {
          vcs.mergeFeatureBranch(featureId, feature.description);
        }
        const desc = feature.description ? `: ${feature.description.replace(/"/g, '\\"')}` : '';
        vcs.commitDurableState(`Feature ${featureId} completed${this.deps.mode !== 'ralph' ? ' and merged' : ''} (no-test mode)${desc}`, [workspace.blueprintFile]);
        
        const updatedFeature = blueprint.getFeatures().find((f) => String(f.id) === String(featureId));
        featurePassed = true;
        break;
      }

      // The Evaluator should always operate in a clean context without the Generator's feedback baggage
      const evaluatorContext = contextSynthesizer.getSurgicalContext(feature);
      const evaluatorPromptArgs = {
        ...promptArgs,
        CONTEXT: evaluatorContext,
        FEEDBACK: 'No previous feedback.'
      };

      if (cycle === 1 && this.deps.mode !== 'ralph') {
        console.log('[*] Performing Meta-Evaluation Chaos Test...');
        const bugFile = injectBug();
        if (bugFile) {
          agentRunner.runAgent(
            'evaluator',
            { contextStr: evaluatorContext },
            { goal: `Evaluate this feature: ${feature.description}`, featureId, cycle, promptArgs: evaluatorPromptArgs }
          );
          
          const postChaosFeat = blueprint.getFeatures().find((f) => String(f.id) === String(featureId));

          if (postChaosFeat && postChaosFeat.passes) {
            console.log("[-] Evaluator FAILED Meta-Evaluation! It passed a broken build.");
            workspace.recordMetric("evaluator_chaos_fails");
            fs.writeFileSync(workspace.feedbackFile, "META-EVALUATION FAILED: You marked a build as 'passes: true' even though it contained a blatant syntax error. Your tests are fake or broken. Fix your testing strategy.", 'utf-8');
            
            blueprint.markFeatureFailed(featureId);
          } else {
            console.log("[+] Evaluator caught the chaos bug successfully.");
            workspace.recordMetric("evaluator_chaos_successes");
            if (fs.existsSync(workspace.feedbackFile)) fs.unlinkSync(workspace.feedbackFile);
          }

          revertBug(bugFile);

          const postRevertFeat = blueprint.getFeatures().find((f) => String(f.id) === String(featureId));
          if (postRevertFeat && postRevertFeat.passes) {
            continue; // Restart cycle
          }
        }
      }

      console.log('[*] Running Evaluator (Real)...');
      agentRunner.runAgent(
        'evaluator',
        { contextStr: evaluatorContext },
        { goal: `Evaluate this feature: ${feature.description}`, featureId, cycle, promptArgs: evaluatorPromptArgs }
      );

      const updatedFeature = blueprint.getFeatures().find((f) => String(f.id) === String(featureId));

      if (updatedFeature && updatedFeature.passes) {
        console.log(`[+] Feature [${featureId}] passed evaluation!`);
        workspace.recordMetric('evaluator_successes');
        if (fs.existsSync(workspace.feedbackFile)) fs.unlinkSync(workspace.feedbackFile);

        if (this.deps.mode !== 'ralph') {
          vcs.mergeFeatureBranch(featureId, feature.description);
        }
        const desc = feature.description ? `: ${feature.description.replace(/"/g, '\\"')}` : '';
        vcs.commitDurableState(`Feature ${featureId} completed${this.deps.mode !== 'ralph' ? ' and merged' : ''}${desc}`, [workspace.blueprintFile]);
        featurePassed = true;
        break;
      } else {
        console.log(`[-] Feature [${featureId}] failed evaluation. Retrying...`);
      }
    }

    if (!featurePassed && cycle >= maxCycles) {
      console.log(`\n[!] WARNING: Feature [${featureId}] failed to pass after ${maxCycles} cycles.`);
      console.log(`[!] Check \`human_advice.md\`. Resuming automatically in 5 seconds (Ctrl+C to abort) ...`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
      return false;
    }

    return featurePassed;
  }
}
