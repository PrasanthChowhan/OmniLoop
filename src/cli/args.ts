export interface CliOptions {
  goal: string;
  commitHash: string | null;
  retryFeatureId: string | null;
  useDocker: boolean;
  skipTest: boolean;
  tasksPath: string | null;
  forceOverwrite: boolean;
  useGithub: boolean;
  globalCustomContextPath: string | null;
  mode: string;
}

export function parseArgs(args: string[]): CliOptions {
  let goal = '';
  let commitHash: string | null = null;
  let retryFeatureId: string | null = null;
  let useDocker = false;
  let skipTest = false;
  let tasksPath: string | null = null;
  let forceOverwrite = false;
  let useGithub = false;
  let globalCustomContextPath: string | null = null;
  let mode = 'omniloop';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
OmniLoop - A prompt-driven, work-agnostic orchestrator

Usage:
  omniloop [goal] [options]

Options:
  --help, -h                Show this help message
  --mode <mode>             Set the execution mode (e.g., 'ralph', 'omniloop')
  --github                  Fetch open GitHub issues and plan them
  --tasks <path>            Read task definitions from the specified folder/file
  --context <path>          Provide a custom context file
  --docker                  Run agents inside a Docker container
  --force                   Overwrite existing blueprint.json if present
  --no-test                 Skip the Evaluator verification phase
  --resume-from-commit <id> Checkout a specific commit before running
  --retry-feature <id>      Rollback and retry a specific feature ID

Examples:
  omniloop "Organize the codebase" --mode ralph
  omniloop --github --mode ralph
  omniloop --tasks ./backlog --mode ralph
      `);
      process.exit(0);
    } else if (args[i] === '--resume-from-commit') {
      commitHash = args[++i];
    } else if (args[i] === '--retry-feature') {
      retryFeatureId = args[++i];
    } else if (args[i] === '--docker') {
      useDocker = true;
    } else if (args[i] === '--github') {
      useGithub = true;
    } else if (args[i] === '--tasks') {
      tasksPath = args[++i];
    } else if (args[i] === '--context') {
      globalCustomContextPath = args[++i];
    } else if (args[i] === '--force') {
      forceOverwrite = true;
    } else if (args[i] === '--no-test') {
      skipTest = true;
    } else if (args[i] === '--mode') {
      mode = args[++i];
    } else if (!args[i].startsWith('--')) {
      goal = args[i];
    }
  }

  return {
    goal,
    commitHash,
    retryFeatureId,
    useDocker,
    skipTest,
    tasksPath,
    forceOverwrite,
    useGithub,
    globalCustomContextPath,
    mode
  };
}
