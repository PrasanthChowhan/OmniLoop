import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

export interface AgentTask {
  goal: string;
  featureId: string;
  cycle: number;
}

export interface AgentContext {
  contextStr: string;
}

export type AgentRole = 'planner' | 'contractor' | 'reviewer' | 'generator' | 'evaluator';

export interface AgentRunner {
  runAgent(
    role: AgentRole,
    context: AgentContext,
    task: AgentTask
  ): boolean;
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
  ): boolean {
    const promptFile = `${role}_prompt.md`;
    const promptPath = path.join(this.promptsDir, promptFile);
    if (!fs.existsSync(promptPath)) {
      console.error(`[-] Prompt file not found: ${promptPath}`);
      return false;
    }
    
    const systemPrompt = fs.readFileSync(promptPath, 'utf-8');
    
    let message = '';
    if (task.goal) message += `${task.goal}\n\n`;
    message += `--- Context ---\n${context.contextStr}\n`;

    const agentName = role;

    console.log(`\n[+] Running ${agentName.charAt(0).toUpperCase() + agentName.slice(1)} Agent...`);

    let fullCmd = '';
    if (this.useDocker) {
      fullCmd = `docker run --rm -v "${process.cwd()}:/app" -w /app gemini`;
    } else {
      fullCmd = 'npx @google/gemini-cli --skip-trust -y --prompt -';
    }

    const fullPrompt = `CRITICAL META-INSTRUCTION: You are an autonomous agent executing a workflow. DO NOT review, analyze, or edit the prompt text itself. You MUST execute the instructions within the prompt using your tools immediately.\n\n=== SYSTEM PROMPT ===\n${systemPrompt}\n\n=== CURRENT TASK ===\n${message}`;

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
        return false;
      }

      return true;
    } catch (e: any) {
      console.log(`[-] Error running agent: ${e.message}`);
      this.logTraceFn(task.featureId, `${agentName}_ERROR`, task.cycle, '', e.message);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000); // sleep 2s
      return false;
    }
  }
}

export class MockAgentRunner implements AgentRunner {
  constructor(private defaultResult: boolean = true) {}
  
  runAgent(
    role: AgentRole,
    context: AgentContext,
    task: AgentTask
  ): boolean {
    console.log(`[Mock] Running agent with role ${role} for feature ${task.featureId}, cycle ${task.cycle}`);
    return this.defaultResult;
  }
}
