// Ollama local model evaluator.
// Docs: https://github.com/ollama/ollama/blob/main/docs/api.md
//
// Config:
//   OLLAMA_HOST — default http://localhost:11434
//   AI_MODEL    — default llama3.2 (or whatever you've pulled)

const DEFAULT_HOST = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2';

function describeModel() {
  return process.env.AI_MODEL || DEFAULT_MODEL;
}

async function evaluate(prompt) {
  const host = (process.env.OLLAMA_HOST || DEFAULT_HOST).replace(/\/$/, '');
  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  const temperature = Number(process.env.AI_TEMPERATURE) || 0;

  const body = {
    model,
    prompt,
    stream: false,
    options: {
      temperature,
      num_predict: Number(process.env.AI_MAX_TOKENS) || 2048,
    },
  };

  const res = await fetch(`${host}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama API ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = await res.json();
  return (data.response || '').trim();
}

module.exports = { evaluate, describeModel };
