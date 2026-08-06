import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const SHELL_BLOCK_MARKER = '\x01';
const SHELL_BLOCK_PATTERN = /!`([^`]+)`/g;
const MARKED_SHELL_BLOCK_PATTERN = new RegExp(`!${SHELL_BLOCK_MARKER}\`([^\`]+)\``, 'g');
const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export async function resolvePrompt(
  promptTemplate: string,
  args: Record<string, string>,
  cwd: string
): Promise<string> {
  // 1. Mark legitimate shell blocks in the raw template
  let markedPrompt = promptTemplate
    .replaceAll(SHELL_BLOCK_MARKER, '')
    .replace(SHELL_BLOCK_PATTERN, `!${SHELL_BLOCK_MARKER}\`$1\``);

  // 2. Sanitize user-provided arguments (strip markers to prevent forgery)
  const sanitizedArgs: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    sanitizedArgs[key] = (value || '').toString().replaceAll(SHELL_BLOCK_MARKER, '');
  }

  // Track used arguments to warn about unused ones
  const usedArgs = new Set<string>();

  // 3. Substitute {{KEY}} placeholders safely
  markedPrompt = markedPrompt.replace(PLACEHOLDER_PATTERN, (match, key) => {
    if (sanitizedArgs[key] === undefined) {
      throw new Error(`Prompt placeholder {{${key}}} has no matching argument.`);
    }
    usedArgs.add(key);
    return sanitizedArgs[key];
  });

  // Warn about unused arguments
  for (const key of Object.keys(sanitizedArgs)) {
    if (!usedArgs.has(key)) {
      console.warn(`[Warning] Unused prompt argument: ${key}`);
    }
  }

  // 4. Find and execute ONLY the securely marked shell blocks
  const matches = [...markedPrompt.matchAll(MARKED_SHELL_BLOCK_PATTERN)];
  if (matches.length === 0) {
    return markedPrompt.replaceAll(SHELL_BLOCK_MARKER, '');
  }

  // Execute commands in parallel
  const executions = matches.map(async (match) => {
    const command = match[1];
    try {
      console.log(`[*] Expanding secure shell block: \`${command}\``);
      const { stdout } = await execAsync(command, { cwd });
      return { match: match[0], output: stdout.trimEnd() };
    } catch (error: any) {
      throw new Error(`Command failed: ${command}\n${error.message}`);
    }
  });

  const results = await Promise.all(executions);

  let finalPrompt = markedPrompt;
  for (const { match, output } of results) {
    finalPrompt = finalPrompt.replace(match, output);
  }

  // 5. Strip any remaining markers before returning
  return finalPrompt.replaceAll(SHELL_BLOCK_MARKER, '');
}
