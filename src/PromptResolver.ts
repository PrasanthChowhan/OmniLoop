import { execSync } from 'child_process';

const SHELL_BLOCK_MARKER = '\x01';
const SHELL_BLOCK_PATTERN = /!`([^`]+)`/g;
const MARKED_SHELL_BLOCK_PATTERN = new RegExp(`!${SHELL_BLOCK_MARKER}\`([^\`]+)\``, 'g');
const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export function resolvePrompt(
  promptTemplate: string,
  args: Record<string, string>,
  cwd: string
): string {
  // 1. Mark legitimate shell blocks in the raw template
  let markedPrompt = promptTemplate
    .replaceAll(SHELL_BLOCK_MARKER, '')
    .replace(SHELL_BLOCK_PATTERN, `!${SHELL_BLOCK_MARKER}\`$1\``);

  // 2. Sanitize user-provided arguments (strip markers to prevent forgery)
  const sanitizedArgs: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    sanitizedArgs[key] = (value || '').toString().replaceAll(SHELL_BLOCK_MARKER, '');
  }

  // 3. Substitute {{KEY}} placeholders safely
  markedPrompt = markedPrompt.replace(PLACEHOLDER_PATTERN, (match, key) => {
    return sanitizedArgs[key] !== undefined ? sanitizedArgs[key] : match;
  });

  // 4. Find and execute ONLY the securely marked shell blocks
  const matches = [...markedPrompt.matchAll(MARKED_SHELL_BLOCK_PATTERN)];
  if (matches.length === 0) {
    return markedPrompt.replaceAll(SHELL_BLOCK_MARKER, '');
  }

  let finalPrompt = markedPrompt;
  for (const match of matches) {
    const command = match[1];
    try {
      console.log(`[*] Expanding secure shell block: \`${command}\``);
      const output = execSync(command, { cwd, encoding: 'utf-8', stdio: 'pipe' });
      finalPrompt = finalPrompt.replace(match[0], output.trimEnd());
    } catch (error: any) {
      console.error(`[!] Shell expansion failed for \`${command}\`: ${error.message}`);
      finalPrompt = finalPrompt.replace(match[0], `[Error executing ${command}: ${error.stderr?.trim() || error.message}]`);
    }
  }

  // 5. Strip any remaining markers before returning
  return finalPrompt.replaceAll(SHELL_BLOCK_MARKER, '');
}
