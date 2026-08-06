import { Feature, BlueprintRepository } from '../state/BlueprintRepository';
import { AgentRunner } from './AgentRunner';
import { Workspace } from '../state/Workspace';
import { Vcs } from '../vcs/Vcs';
import { ContextSynthesizer } from '../state/ContextSynthesizer';
import { Logger } from '../utils/logger';

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
    Logger.info(`----------------------------------------------------`);
    Logger.info(`Sprint: [${featureId}] ${feature.description}`);
    Logger.info(`----------------------------------------------------`);

    if (this.deps.mode !== 'ralph') {
      vcs.checkoutFeatureBranch(featureId);
    } else {
      Logger.info(`Ralph Mode: Operating on current branch (Work Agnostic).`);
    }

    // --- Phase 1: Contract Negotiation ---
    let contractApproved = false;
    let contractCycle = 0;
    
    if (this.deps.mode === 'ralph') {
      Logger.info('Ralph Mode selected. Skipping Contract Negotiation (Phase 1).');
      contractApproved = true;
    } else {
      while (contractCycle < maxCycles && !contractApproved) {
        contractCycle++;
        Logger.info(`--- Contract Cycle ${contractCycle}/${maxCycles} ---`);
        let contractContext = contextSynthesizer.getSurgicalContext(feature);
        if (workspace.hasFeedbackFile()) {
          const feedback = workspace.readFeedbackFile();
          const truncatedFeedback = feedback.length > 5000 ? '...[TRUNCATED TO PREVENT EXHAUSTION]...\n' + feedback.substring(feedback.length - 5000) : feedback;
          contractContext += `\nContract Feedback:\n${truncatedFeedback}\n`;
        }

        Logger.info('Running Contractor...');
        await agentRunner.runAgent(
          'contractor',
          { contextStr: contractContext },
          { goal: `Create a contract for: ${feature.description}`, featureId, cycle: contractCycle }
        );

        Logger.info('Running Reviewer...');
        await agentRunner.runAgent(
          'reviewer',
          { contextStr: contractContext },
          { goal: `Review the contract for: ${feature.description}`, featureId, cycle: contractCycle }
        );

        if (workspace.hasContractApprovedFile()) {
          Logger.success('Contract approved!');
          contractApproved = true;
          workspace.deleteContractApprovedFile();
          workspace.deleteFeedbackFile();
        } else {
          Logger.error(`Contract rejected or missing approval. Retrying...`);
        }
      }

      if (!contractApproved) {
        Logger.warn(`Feature [${featureId}] failed to negotiate a contract after ${maxCycles} cycles.`);
        Logger.warn(`Check \`human_advice.md\`. Resuming automatically in 5 seconds (Ctrl+C to abort) ...`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
        return false;
      }
    }


    // --- Phase 2: Implementation ---
    let cycle = 0;
    let featurePassed = false;
    while (cycle < maxCycles) {
      cycle++;
      Logger.info(`--- Implementation Cycle ${cycle}/${maxCycles} ---`);

      let generatorContext = contextSynthesizer.getSurgicalContext(feature);
      if (workspace.hasSprintContractFile()) {
        const contract = workspace.readSprintContractFile();
        const truncatedContract = contract.length > 8000 ? '...[TRUNCATED TO PREVENT EXHAUSTION]...\n' + contract.substring(contract.length - 8000) : contract;
        generatorContext += `\nApproved Sprint Contract:\n${truncatedContract}\n`;
      }
      if (workspace.hasFeedbackFile()) {
        const feedback = workspace.readFeedbackFile();
        const truncatedFeedback = feedback.length > 5000 ? '...[TRUNCATED TO PREVENT EXHAUSTION]...\n' + feedback.substring(feedback.length - 5000) : feedback;
        generatorContext += `\nEvaluator Feedback:\n${truncatedFeedback}\n`;
      }

      const promptArgs = {
        TASK_DESCRIPTION: feature.description,
        CUSTOM_SYSTEM_PROMPT: feature.customSystemPrompt || '',
        CONTEXT: generatorContext,
        FEEDBACK: workspace.hasFeedbackFile() ? workspace.readFeedbackFile() : 'No previous feedback.'
      };

      Logger.info('Running Generator...');
      const { success } = await agentRunner.runAgent(
        'generator',
        { contextStr: generatorContext },
        { goal: `Focus on this feature: ${feature.description}`, featureId, cycle, promptArgs }
      );
      if (success) workspace.recordMetric('generator_successes');

      if (skipTest) {
        Logger.success(`Skipping evaluation phase for Feature [${featureId}] due to --no-test flag.`);
        blueprint.markFeaturePassed(featureId);
        workspace.deleteFeedbackFile();

        if (this.deps.mode !== 'ralph') {
          vcs.mergeFeatureBranch(featureId, feature.description);
        }
        const desc = feature.description ? `: ${feature.description.replace(/"/g, '\\"')}` : '';
        vcs.commitDurableState(`Feature ${featureId} completed${this.deps.mode !== 'ralph' ? ' and merged' : ''} (no-test mode)${desc}`, [workspace.blueprintFile]);
        
        const updatedFeature = blueprint.getFeatures().find((f: any) => String(f.id) === String(featureId));
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
        Logger.info('Performing Meta-Evaluation Chaos Test...');
        const bugFile = injectBug();
        if (bugFile) {
          await agentRunner.runAgent(
            'evaluator',
            { contextStr: evaluatorContext },
            { goal: `Evaluate this feature: ${feature.description}`, featureId, cycle, promptArgs: evaluatorPromptArgs }
          );
          
          const postChaosFeat = blueprint.getFeatures().find((f: any) => String(f.id) === String(featureId));

          if (postChaosFeat && postChaosFeat.passes) {
            Logger.error("Evaluator FAILED Meta-Evaluation! It passed a broken build.");
            workspace.recordMetric("evaluator_chaos_fails");
            workspace.writeFeedbackFile("META-EVALUATION FAILED: You marked a build as 'passes: true' even though it contained a blatant syntax error. Your tests are fake or broken. Fix your testing strategy.");
            
            blueprint.markFeatureFailed(featureId);
          } else {
            Logger.success("Evaluator caught the chaos bug successfully.");
            workspace.recordMetric("evaluator_chaos_successes");
            workspace.deleteFeedbackFile();
          }

          revertBug(bugFile);

          const postRevertFeat = blueprint.getFeatures().find((f: any) => String(f.id) === String(featureId));
          if (postRevertFeat && postRevertFeat.passes) {
            continue; // Restart cycle
          }
        }
      }

      Logger.info('Running Evaluator (Real)...');
      await agentRunner.runAgent(
        'evaluator',
        { contextStr: evaluatorContext },
        { goal: `Evaluate this feature: ${feature.description}`, featureId, cycle, promptArgs: evaluatorPromptArgs }
      );

      const updatedFeature = blueprint.getFeatures().find((f: any) => String(f.id) === String(featureId));

      if (updatedFeature && updatedFeature.passes) {
        Logger.success(`Feature [${featureId}] passed evaluation!`);
        workspace.recordMetric('evaluator_successes');
        workspace.deleteFeedbackFile();

        if (this.deps.mode !== 'ralph') {
          vcs.mergeFeatureBranch(featureId, feature.description);
        }
        const desc = feature.description ? `: ${feature.description.replace(/"/g, '\\"')}` : '';
        vcs.commitDurableState(`Feature ${featureId} completed${this.deps.mode !== 'ralph' ? ' and merged' : ''}${desc}`, [workspace.blueprintFile]);
        featurePassed = true;
        break;
      } else {
        Logger.error(`Feature [${featureId}] failed evaluation. Retrying...`);
      }
    }

    if (!featurePassed && cycle >= maxCycles) {
      Logger.warn(`Feature [${featureId}] failed to pass after ${maxCycles} cycles.`);
      Logger.warn(`Check \`.omniloop/human_advice.md\`. Resuming automatically in 5 seconds (Ctrl+C to abort) ...`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
      return false;
    }

    return featurePassed;
  }
}
