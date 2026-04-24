// AI provider abstraction.
//
// Each evaluator exports `evaluate(prompt, opts)` returning a Promise<string>
// (the raw text response from the model). The orchestrator (claude.js) picks
// one based on the AI_PROVIDER env var.

const PROVIDERS = {
  'claude-cli':  require('./claude-cli'),
  'anthropic':   require('./anthropic'),
  'openai':      require('./openai-compatible'),
  'ollama':      require('./ollama'),
  'gemini':      require('./gemini'),
};

const DEFAULT_PROVIDER = 'claude-cli';

function getEvaluator() {
  const name = (process.env.AI_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(
      `Unknown AI_PROVIDER: "${name}". Valid options: ${Object.keys(PROVIDERS).join(', ')}`
    );
  }
  return provider;
}

function getActiveProviderInfo() {
  const name = (process.env.AI_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase();
  const provider = PROVIDERS[name];
  return {
    name,
    available: !!provider,
    model: provider?.describeModel?.() || null,
  };
}

module.exports = { getEvaluator, getActiveProviderInfo, PROVIDERS };
