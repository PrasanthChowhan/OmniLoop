import * as path from 'path';
import * as fs from 'fs';

export class Workspace {
  public readonly omniloopDir: string = '.omniloop';
  public readonly tracesFile: string;
  public readonly metricsFile: string;
  public readonly blueprintFile: string;
  public readonly sprintContractFile: string;
  public readonly sprintInitFile: string;
  public readonly feedbackFile: string;
  public readonly humanAdviceFile: string;
  public readonly contractApprovedFile: string;

  constructor(private rootDir: string = process.cwd()) {
    this.tracesFile = path.join(this.omniloopDir, 'omniloop_traces.jsonl');
    this.metricsFile = path.join(this.omniloopDir, 'metrics.json');
    this.blueprintFile = path.join(this.omniloopDir, 'blueprint.json');
    this.sprintContractFile = path.join(this.omniloopDir, 'sprint_contract.md');
    this.sprintInitFile = path.join(this.omniloopDir, 'init.sh');
    this.feedbackFile = path.join(this.omniloopDir, 'sprint_feedback.md');
    this.humanAdviceFile = path.join(this.omniloopDir, 'human_advice.md');
    this.contractApprovedFile = path.join(this.omniloopDir, 'contract_approved.txt');

    this.ensureOmniLoopDir();
  }

  private ensureOmniLoopDir(): void {
    if (!fs.existsSync(this.omniloopDir)) {
      fs.mkdirSync(this.omniloopDir, { recursive: true });
    }
  }

  public loadJson(filepath: string, defaultVal: any = null): any {
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

  public saveJson(filepath: string, data: any): void {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
  }

  public recordMetric(key: string, increment: number = 1): void {
    const metrics = this.loadJson(this.metricsFile);
    metrics[key] = (metrics[key] || 0) + increment;
    this.saveJson(this.metricsFile, metrics);
  }

  public logTrace(featureId: string, agentName: string, cycle: number, stdout: string, stderr: string): void {
    const trace = {
      timestamp: new Date().toISOString(),
      feature_id: featureId,
      agent_type: agentName,
      cycle_number: cycle,
      stdout,
      stderr,
      metadata: {
        model_version: 'unknown',
        tokens: 0
      }
    };
    fs.appendFileSync(this.tracesFile, JSON.stringify(trace) + '\n', 'utf-8');
  }
}
