// Claude Code CLI evaluator.
// Invokes the `claude` binary as a subprocess with -p (print mode).
// Uses the user's Claude subscription auth — no API key needed.

const { execFile } = require('child_process');

const CLAUDE_CLI = process.env.CLAUDE_CLI_PATH || 'claude';

function describeModel() {
  return process.env.AI_MODEL || 'claude-code-default';
}

async function evaluate(prompt) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'text'];
    if (process.env.AI_MODEL) args.push('--model', process.env.AI_MODEL);
    args.push(prompt);

    const child = execFile(CLAUDE_CLI, args, {
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env },
    }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`Claude CLI error: ${error.message}\n${stderr}`));
      }
      resolve(stdout.trim());
    });

    // Force kill if the process hangs past the timeout grace
    child.on('timeout', () => {
      try { child.kill('SIGKILL'); } catch {}
    });
  });
}

module.exports = { evaluate, describeModel };
