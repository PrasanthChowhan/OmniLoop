import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Feature } from './BlueprintRepository';
import { Vcs } from './Vcs';

export class ContextSynthesizer {
  private readonly MAX_CONTEXT_LENGTH = 40000;

  constructor(
    private vcs: Vcs,
    private humanAdviceFile: string,
    private globalCustomContextPath: string | null = null
  ) {}

  public getSurgicalContext(feature: Feature): string {
    let context = '';

    const appendContext = (label: string, content: string, maxLength: number = 10000) => {
      const truncated = content.length > maxLength 
        ? content.substring(0, maxLength) + '\n...[TRUNCATED TO PREVENT CONTEXT EXHAUSTION]...' 
        : content;
      context += `### ${label} ###\n${truncated}\n\n`;
    };

    // 1. Target Feature (Highest Priority)
    context += `Target Feature:\n${JSON.stringify(feature, null, 2)}\n\n`;

    // 2. Inject Custom Context from CLI
    if (this.globalCustomContextPath && fs.existsSync(this.globalCustomContextPath)) {
      const stat = fs.statSync(this.globalCustomContextPath);
      if (stat.isFile()) {
        console.log(`[+] Injecting custom context from ${this.globalCustomContextPath}`);
        appendContext('ADDITIONAL CONTEXT', fs.readFileSync(this.globalCustomContextPath, 'utf-8'), 10000);
      }
    }

    // 3. Inject Global/Project Context
    const projectContextPaths = ['context.md', 'AGENTS.md'];
    for (const cPath of projectContextPaths) {
      if (fs.existsSync(cPath)) {
        const stat = fs.statSync(cPath);
        if (stat.isFile()) {
          console.log(`[+] Injecting project context from ${cPath}`);
          appendContext(`PROJECT CONTEXT (${cPath})`, fs.readFileSync(cPath, 'utf-8'), 5000);
        } else if (stat.isDirectory()) {
          try {
            const files = fs.readdirSync(cPath, { recursive: true });
            let dirContext = '';
            for (const file of files) {
              const fullPath = path.join(cPath, file.toString());
              if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile() && (fullPath.endsWith('.md') || fullPath.endsWith('.txt'))) {
                dirContext += `\n--- ${file.toString()} ---\n${fs.readFileSync(fullPath, 'utf-8')}\n`;
              }
            }
            if (dirContext) {
              console.log(`[+] Injecting project context from directory ${cPath}`);
              appendContext(`PROJECT CONTEXT (${cPath}/*)`, dirContext, 8000);
            }
          } catch (e) {
            console.error(`[-] Could not read directory ${cPath}`, e);
          }
        }
      }
    }

    // 4. VCS & Symbol Context (Optimized)
    let hasCtags = false;
    try {
      execSync('ctags --version', { stdio: 'ignore' });
      hasCtags = true;
    } catch {
      hasCtags = false;
    }

    if (hasCtags) {
      const recentFiles = this.vcs.getChangedFilesFromBase();
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
        appendContext('Relevant Symbols (CTAGS)', tagsOut, 8000);
      }
    } else {
      const recentCommits = this.vcs.getRecentCommitHistory(3);
      if (recentCommits) {
        context += `Recent Git History:\n${recentCommits}\n\n`;
      }
      // V2 FIX: Use diff --stat instead of full raw diff
      const diffStat = this.vcs.getDiffStatFromBase();
      if (diffStat) {
        context += `Changes in this feature branch (Diff Stat):\n${diffStat}\n\n`;
      }
    }

    // 5. Human Advice Side-Channel
    if (fs.existsSync(this.humanAdviceFile)) {
      const advice = fs.readFileSync(this.humanAdviceFile, 'utf-8').trim();
      if (advice) {
        context += `\n### HUMAN ADVICE ###\nThe human user has provided the following mid-sprint direction. You MUST follow it:\n${advice}\n\n`;
        console.log('[+] Injected Human Advice side-channel.');
        fs.writeFileSync(this.humanAdviceFile, '', 'utf-8');
      }
    }

    // 6. Hard limit to avoid Context Urgency
    if (context.length > this.MAX_CONTEXT_LENGTH) {
      console.warn(`[!] Context string exceeded ${this.MAX_CONTEXT_LENGTH} characters. Truncating to prevent Context Urgency.`);
      context = context.substring(0, this.MAX_CONTEXT_LENGTH) + '\n...[GLOBAL CONTEXT TRUNCATED DUE TO SIZE LIMITS]...';
    }

    return context;
  }
}

