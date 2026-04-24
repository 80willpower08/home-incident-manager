// Google Gemini API evaluator.
// Docs: https://ai.google.dev/api/rest/v1beta/models/generateContent
//
// Config:
//   GEMINI_API_KEY — required
//   AI_MODEL       — default gemini-2.5-flash (fast + cheap)

const DEFAULT_MODEL = 'gemini-2.5-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function describeModel() {
  return process.env.AI_MODEL || DEFAULT_MODEL;
}

async function evaluate(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  const temperature = Number(process.env.AI_TEMPERATURE) || 0;
  const maxTokens = Number(process.env.AI_MAX_TOKENS) || 2048;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      responseMimeType: 'text/plain',
    },
  };

  const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts
    ?.map(p => p.text)
    .filter(Boolean)
    .join('\n') || '';
  return text.trim();
}

module.exports = { evaluate, describeModel };
