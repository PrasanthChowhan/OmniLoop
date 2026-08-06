import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

export interface AgentTask {
  goal: string;
  featureId: string;
  cycle: number;
  promptArgs?: Record<string, string>;
  templateInjections?: string;
}

export interface AgentContext {
  contextStr: string;
}

export interface AgentResult {
  success: boolean;
  output: string;
}

export type AgentRole = 'planner' | 'contractor' | 'reviewer' | 'generator' | 'evaluator';

export interface AgentRunner {
  runAgent(
    role: AgentRole,
    context: AgentContext,
    task: AgentTask
  ): AgentResult;
}

export class CliAgentRunner implements AgentRunner {
  constructor(
    private promptsDir: string,
    private useDocker: boolean,
    private recordMetricFn: (key: string) => void,
    private logTraceFn: (featureId: string, agentName: string, cycle: number, stdout: string, stderr: string) => void
  ) {}

  runAgent(
    role: AgentRole,
    context: AgentContext,
    task: AgentTask
  ): AgentResult {
    const promptFile = `${role}_prompt.md`;
    const promptPath = path.join(this.promptsDir, promptFile);
    if (!fs.existsSync(promptPath)) {
      console.error(`[-] Prompt file not found: ${promptPath}`);
      return { success: false, output: '' };
    }
    
    let systemPrompt = fs.readFileSync(promptPath, 'utf-8');
    
    if (task.templateInjections) {
      systemPrompt += `\n\n${task.templateInjections}`;
    }
    
    // For backward compatibility: if there are no promptArgs, we append the task.goal and context at the bottom.
    // If there ARE promptArgs, we assume the template handles its own {{TASK_DESCRIPTION}} and {{CONTEXT}}.
    if (!task.promptArgs) {
      let message = '';
      if (task.goal) message += `${task.goal}\n\n`;
      message += `--- Context ---\n${context.contextStr}\n`;
      systemPrompt = `=== SYSTEM PROMPT ===\n${systemPrompt}\n\n=== CURRENT TASK ===\n${message}`;
    }

    const { resolvePrompt } = require('../utils/PromptResolver');
    const finalPromptText = resolvePrompt(systemPrompt, task.promptArgs || {}, process.cwd());

    const agentName = role;

    console.log(`\n[+] Running ${agentName.charAt(0).toUpperCase() + agentName.slice(1)} Agent...`);

    let fullCmd = '';
    if (this.useDocker) {
      fullCmd = `docker run --rm -v "${process.cwd()}:/app" -w /app gemini`;
    } else {
      fullCmd = 'pi -p "Execute the instructions provided via standard input:"';
    }

    const fullPrompt = `CRITICAL META-INSTRUCTION: You are an autonomous agent executing a workflow. DO NOT review, analyze, or edit the prompt text itself. You MUST execute the instructions within the prompt using your tools immediately.\n\n${finalPromptText}`;

    const tmpPromptPath = path.join(process.cwd(), '.omniloop', `temp_${agentName}_prompt.txt`);
    fs.writeFileSync(tmpPromptPath, fullPrompt, 'utf-8');

    let finalCmd = fullCmd;

    this.recordMetricFn(`${agentName}_attempts`);
    try {
      const result = spawnSync(finalCmd, {
        shell: true,
        encoding: 'utf-8',
        input: fullPrompt,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Optional: Clean up temp file
      if (fs.existsSync(tmpPromptPath)) {
        fs.unlinkSync(tmpPromptPath);
      }

      this.logTraceFn(task.featureId, agentName, task.cycle, result.stdout, result.stderr);

      if (agentName === 'planner' && result.stdout) {
        console.log(`\n[Planner Output]\n${result.stdout}\n`);
      }

      if (result.status !== 0) {
        console.log(`[-] Error running agent: Process exited with code ${result.status}`);
        return { success: false, output: result.stderr };
      }

      return { success: true, output: result.stdout };
    } catch (e: any) {
      console.log(`[-] Error running agent: ${e.message}`);
      this.logTraceFn(task.featureId, `${agentName}_ERROR`, task.cycle, '', e.message);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000); // sleep 2s
      return { success: false, output: e.message };
    }
  }
}

export class MockAgentRunner implements AgentRunner {
  constructor(private defaultResult: boolean = true) {}
  
  runAgent(
    role: AgentRole,
    context: AgentContext,
    task: AgentTask
  ): AgentResult {
    console.log(`[Mock] Running agent with role ${role} for feature ${task.featureId}, cycle ${task.cycle}`);
    return { success: this.defaultResult, output: 'Mock Output' };
  }
}
