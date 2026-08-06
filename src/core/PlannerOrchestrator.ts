import * as fs from 'fs';
import { AgentRunner } from './AgentRunner';
import { BlueprintRepository } from '../state/BlueprintRepository';
import { Workspace } from '../state/Workspace';
import { Vcs } from '../vcs/Vcs';
import { extractXmlTag } from '../utils/StructuredOutput';
import { Logger } from '../utils/logger';

export class PlannerOrchestrator {
  constructor(
    private agentRunner: AgentRunner,
    private blueprint: BlueprintRepository,
    private workspace: Workspace,
    private vcs: Vcs
  ) {}

  public async runPlanner(goal: string, useGithub: boolean, tasksPath: string | null): Promise<void> {
    if (!goal.trim() && !useGithub && !tasksPath) {
      Logger.error('No blueprint.json found. You must provide a goal, --github, or --tasks.');
      process.exit(1);
    }

    let templateInjections = '';
    if (useGithub) {
      templateInjections += "\n<github-issues>\n!`gh issue list --state open --json number,title,body`\n</github-issues>\n";
    }
    if (tasksPath) {
      templateInjections += `\n<task-files>\n!\`cat ${tasksPath}/*.md || cat ${tasksPath}/*.txt || echo "No text files found in ${tasksPath}"\`\n</task-files>\n`;
    }

    Logger.info('Running Planner...');
    const result = await this.agentRunner.runAgent('planner', { contextStr: '' }, {
      goal,
      featureId: 'init',
      cycle: 0,
      promptArgs: { TASK_DESCRIPTION: goal },
      templateInjections
    });

    if (!result.success) {
      Logger.error('Planner failed to execute. Exiting.');
      process.exit(1);
    }

    const planJsonStr = extractXmlTag(result.output, 'plan');
    if (!planJsonStr) {
      Logger.error('Planner did not output a valid <plan> tag. Exiting.');
      console.log(`Raw output: ${result.output}`);
      process.exit(1);
    }

    try {
      const plan = JSON.parse(planJsonStr);
      if (plan.features && Array.isArray(plan.features)) {
        this.blueprint.saveFeatures(plan.features);
      } else {
        throw new Error('Invalid plan format: missing features array');
      }
    } catch (e: any) {
      Logger.error(`Failed to parse planner output: ${e.message}`);
      process.exit(1);
    }

    this.workspace.recordMetric('planner_successes');
    this.vcs.commitDurableState('Initial feature spec generated', [this.workspace.blueprintFile]);

    if (this.workspace.hasSprintInitFile()) {
      Logger.warn('SECURITY WARNING: The Planner generated an `init.sh` script to scaffold the project.');
      Logger.warn('To prevent arbitrary code execution, OmniLoop will NOT execute this automatically.');
      Logger.warn(`Please review the script at ${this.workspace.sprintInitFile} and run it manually if trusted.`);
    }

    Logger.warn('blueprint.json generated. The process will continue automatically in 5 seconds (or press Ctrl+C to abort and review).');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
  }
}
