// Anthropic API evaluator.
// Uses direct REST API calls (no SDK dependency).
// Docs: https://docs.anthropic.com/en/api/messages

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 2048;

function describeModel() {
  return process.env.AI_MODEL || DEFAULT_MODEL;
}

async function evaluate(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  const maxTokens = Number(process.env.AI_MAX_TOKENS) || DEFAULT_MAX_TOKENS;
  const temperature = Number(process.env.AI_TEMPERATURE) || 0;

  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [{ role: 'user', content: prompt }],
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = await res.json();
  // Response shape: { content: [{ type: 'text', text: '...' }, ...] }
  const text = (data.content || [])
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n');
  return text.trim();
}

module.exports = { evaluate, describeModel };
