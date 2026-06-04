import { execSync } from 'child_process';

export interface Vcs {
  runGitCommand(args: string[]): string;
  checkoutFeatureBranch(featureId: string): void;
  mergeFeatureBranch(featureId: string, featureDescription?: string): void;
  commitDurableState(message: string, files: string[]): void;
}

export class GitVcs implements Vcs {
  constructor() {
    this.ensureInitialized();
  }

  private ensureInitialized(): void {
    try {
      execSync('git rev-parse --is-inside-work-tree', { encoding: 'utf-8', stdio: 'ignore' });
    } catch (error) {
      console.log('[*] Git not initialized. Initializing repository...');
      this.runGitCommand(['init']);
      this.runGitCommand(['add', '.']);
      this.runGitCommand(['commit', '-m', '"Initial commit"']);
      this.runGitCommand(['branch', '-m', 'main']);
    }
  }

  public runGitCommand(args: string[]): string {
    try {
      const result = execSync(`git ${args.join(' ')}`, { encoding: 'utf-8', stdio: 'pipe' });
      return result.trim();
    } catch (error: any) {
      console.error(`[!] Git error: ${error.stderr?.trim() || error.message}`);
      return '';
    }
  }

  public checkoutFeatureBranch(featureId: string): void {
    const branchName = `feature_${featureId}`;
    const current = this.runGitCommand(['branch', '--show-current']);
    if (current === branchName) return;

    const branches = this.runGitCommand(['branch', '--list', branchName]);
    if (branches.includes(branchName)) {
      this.runGitCommand(['checkout', branchName]);
    } else {
      this.runGitCommand(['checkout', '-b', branchName]);
    }
  }

  public mergeFeatureBranch(featureId: string, featureDescription: string = ''): void {
    const branchName = `feature_${featureId}`;
    const desc = featureDescription ? `: ${featureDescription.replace(/"/g, '\\"')}` : '';
    
    // Auto-commit any lingering files the Generator forgot to commit
    this.runGitCommand(['add', '-A']);
    this.runGitCommand(['commit', '-m', `"Auto-commit generated code for feature ${featureId}${desc}"`]);

    this.runGitCommand(['checkout', 'main']);
    this.runGitCommand(['merge', '--no-ff', branchName, '-m', `"Merge feature ${featureId}${desc}"`]);
    this.runGitCommand(['branch', '-d', branchName]);
  }

  public commitDurableState(message: string, files: string[]): void {
    for (const file of files) {
      this.runGitCommand(['add', file]);
    }
    this.runGitCommand(['commit', '-m', `"${message}"`]);
  }
}
