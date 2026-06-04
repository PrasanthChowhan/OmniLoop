import * as fs from 'fs';
import * as path from 'path';
import { Feature, BlueprintRepository } from './BlueprintRepository';
import { Vcs } from './Vcs';
import { Workspace } from './Workspace';

export interface FeatureSource {
  fetchFeatures(forceOverwrite: boolean): Promise<Feature[]>;
  markFeatureComplete(feature: Feature): Promise<void>;
}

export class GitHubFeatureSource implements FeatureSource {
  constructor(private vcs: Vcs) {}

  public async fetchFeatures(forceOverwrite: boolean): Promise<Feature[]> {
    const ghToken = process.env.GH_TOKEN;
    if (!ghToken) {
      throw new Error('GH_TOKEN environment variable is missing.');
    }

    console.log('[*] Inferring repository from git remote origin...');
    const remoteUrl = this.vcs.getRemoteOriginUrl();
    if (!remoteUrl) {
      throw new Error('Failed to get git remote origin URL.');
    }

    const repoMatch = remoteUrl.match(/github\.com[:\/]([^\/]+)\/([^\/\.]+)/);
    if (!repoMatch) {
      throw new Error(`Could not parse GitHub owner/repo from remote URL: ${remoteUrl}`);
    }

    const owner = repoMatch[1];
    const repo = repoMatch[2].replace(/\.git$/, '');
    console.log(`[+] Found repository: ${owner}/${repo}`);

    console.log('[*] Fetching open issues with label "Ready for agent"...');
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/issues?state=open&labels=Ready+for+agent`;
    
    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `Bearer ${ghToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'omniloop'
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned an error: ${response.status} ${response.statusText}`);
    }

    const issues: any = await response.json();
    if (!Array.isArray(issues) || issues.length === 0) {
      return [];
    }

    return issues.map((issue: any, index: number) => ({
      id: (index + 1).toString(),
      description: `Issue #${issue.number}: ${issue.title}\n\n${issue.body || ''}`,
      passes: false,
      sourceContext: {
        issueNumber: issue.number,
        repo: `${owner}/${repo}`
      }
    }));
  }

  public async markFeatureComplete(feature: Feature): Promise<void> {
    const ghToken = process.env.GH_TOKEN;
    if (!ghToken) return;

    if (!feature.sourceContext || !feature.sourceContext.repo || !feature.sourceContext.issueNumber) {
      return;
    }

    const repo = feature.sourceContext.repo;
    const issueNumber = feature.sourceContext.issueNumber;

    console.log(`[*] Closing GitHub issue #${issueNumber} on ${repo}...`);
    try {
      await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ghToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'omniloop',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ body: 'Completed by AI OmniLoop.' })
      });

      await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${ghToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'omniloop',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ state: 'closed' })
      });
      console.log(`[+] GitHub issue #${issueNumber} closed.`);
    } catch (error: any) {
      console.error(`[-] Failed to close GitHub issue: ${error.message}`);
    }
  }
}

export class FileSystemFeatureSource implements FeatureSource {
  constructor(private tasksPath: string, private workspace: Workspace) {}

  public async fetchFeatures(forceOverwrite: boolean): Promise<Feature[]> {
    console.log(`[*] Generating blueprint.json from custom tasks at ${this.tasksPath}...`);
    const features: Feature[] = [];
    
    if (!fs.existsSync(this.tasksPath)) {
      throw new Error(`Tasks path ${this.tasksPath} does not exist.`);
    }

    const stat = fs.statSync(this.tasksPath);
    if (stat.isDirectory()) {
      const files = fs.readdirSync(this.tasksPath).filter(f => f.endsWith('.md') || f.endsWith('.txt')).sort();
      files.forEach((file, index) => {
        const content = fs.readFileSync(path.join(this.tasksPath, file), 'utf-8');
        features.push({
          id: (index + 1).toString(),
          description: `Task from ${file}:\n${content.trim()}`,
          passes: false
        });
      });
    } else if (stat.isFile()) {
      const data = this.workspace.loadJson(this.tasksPath);
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
        data.features.forEach((f: any, i: number) => {
          features.push({
            id: f.id || (i + 1).toString(),
            description: f.description || '',
            passes: false
          });
        });
      } else {
        throw new Error(`Unrecognized JSON format in ${this.tasksPath}. Expected an array or { features: [] }.`);
      }
    }

    return features;
  }

  public async markFeatureComplete(feature: Feature): Promise<void> {
    // No-op for file system tasks
  }
}
