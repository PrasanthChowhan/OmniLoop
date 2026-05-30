import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Feature } from './BlueprintRepository';
import { Vcs } from './Vcs';

export class ContextSynthesizer {
  constructor(
    private vcs: Vcs,
    private humanAdviceFile: string,
    private globalCustomContextPath: string | null = null
  ) {}

  public getSurgicalContext(feature: Feature): string {
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
    if (this.globalCustomContextPath && fs.existsSync(this.globalCustomContextPath)) {
      const stat = fs.statSync(this.globalCustomContextPath);
      if (stat.isFile()) {
        console.log(`[+] Injecting custom context from ${this.globalCustomContextPath}`);
        context += `### ADDITIONAL CONTEXT ###\n${fs.readFileSync(this.globalCustomContextPath, 'utf-8')}\n\n`;
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
      const recentFiles = this.vcs.runGitCommand(['diff', 'main', '--name-only']).split('\n');
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
      const recentCommits = this.vcs.runGitCommand(['log', '--oneline', '-n', '3']);
      if (recentCommits) {
        context += `Recent Git History:\n${recentCommits}\n\n`;
      }
      const diff = this.vcs.runGitCommand(['diff', 'main']);
      if (diff) {
        context += `Changes in this feature branch:\n${diff}\n\n`;
      }
    }

    // Human Advice Side-Channel
    if (fs.existsSync(this.humanAdviceFile)) {
      const advice = fs.readFileSync(this.humanAdviceFile, 'utf-8').trim();
      if (advice) {
        context += `\n### HUMAN ADVICE ###\nThe human user has provided the following mid-sprint direction. You MUST follow it:\n${advice}\n\n`;
        console.log('[+] Injected Human Advice side-channel.');
        fs.writeFileSync(this.humanAdviceFile, '', 'utf-8');
      }
    }

    return context;
  }
}

