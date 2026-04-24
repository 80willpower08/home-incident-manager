// OpenAI-compatible chat completions evaluator.
//
// Works with:
// - OpenAI (api.openai.com)
// - LM Studio, vLLM, localai — any server speaking the OpenAI chat completions protocol
// - Cloud alternatives (Together, Groq, Fireworks, etc. with appropriate base URL)
//
// Config:
//   OPENAI_API_KEY    — required (for real OpenAI); local servers usually accept any value
//   OPENAI_BASE_URL   — e.g. http://localhost:1234/v1 for LM Studio. Default: https://api.openai.com/v1
//   AI_MODEL          — model name the endpoint knows about (e.g. gpt-4o-mini, llama-3.1-8b-instruct)

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

function describeModel() {
  return process.env.AI_MODEL || DEFAULT_MODEL;
}

async function evaluate(prompt) {
  const apiKey = process.env.OPENAI_API_KEY || 'sk-local-no-key-needed';
  const baseUrl = (process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  const temperature = Number(process.env.AI_TEMPERATURE) || 0;
  const maxTokens = Number(process.env.AI_MAX_TOKENS) || 2048;

  const body = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI-compat API ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return text.trim();
}

module.exports = { evaluate, describeModel };
