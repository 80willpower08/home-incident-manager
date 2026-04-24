# AI Providers

HIM supports five AI backends. Pick one with `AI_PROVIDER=<name>`.

| Provider       | `AI_PROVIDER` value | Best for |
|----------------|---------------------|----------|
| Claude Code CLI| `claude-cli`        | You have a Claude Max / Pro subscription; no API cost |
| Anthropic API  | `anthropic`         | You want Claude via API key (pay-per-use) |
| OpenAI-compat  | `openai`            | OpenAI, LM Studio, vLLM, any server speaking OpenAI's protocol |
| Ollama         | `ollama`            | Fully local models, privacy-first |
| Google Gemini  | `gemini`            | Free tier available, fast |

Universal optional settings (honored where it makes sense):

```
AI_MODEL=...            # model identifier for the chosen provider
AI_TEMPERATURE=0        # deterministic recommended
AI_MAX_TOKENS=2048      # response cap
```

## Claude Code CLI (`claude-cli`)

Uses the `claude` binary installed on the host with your Claude account OAuth.

```
AI_PROVIDER=claude-cli
# CLAUDE_CLI_PATH=claude   # optional — path to claude binary
```

**Setup:**
1. Install Claude Code: see https://docs.claude.com/en/docs/claude-code
2. One-time interactive login: in your container/host run `claude` then `/login`
3. HIM subprocess-invokes `claude -p` for each evaluation

**Containerized:** the provided Dockerfile installs `@anthropic-ai/claude-code` globally. Mount a volume at `/data/home` so the OAuth credentials persist.

## Anthropic API (`anthropic`)

Direct REST API calls to `api.anthropic.com`. Requires an API key with credit.

```
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
# AI_MODEL=claude-sonnet-4-6   # default
```

Get an API key at https://console.anthropic.com.

## OpenAI-compatible (`openai`)

Works with OpenAI and any service speaking OpenAI's `/v1/chat/completions` protocol — LM Studio, vLLM, text-generation-webui with the OAI plugin, Together, Groq, Fireworks, etc.

```
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1   # default
AI_MODEL=gpt-4o-mini
```

**LM Studio** (local):
```
OPENAI_BASE_URL=http://host.docker.internal:1234/v1
OPENAI_API_KEY=lm-studio-no-key-needed
AI_MODEL=llama-3.2-3b-instruct      # whatever you've loaded
```

**Together.ai / Groq / Fireworks:**
```
OPENAI_BASE_URL=https://api.together.xyz/v1
OPENAI_API_KEY=<their key>
AI_MODEL=meta-llama/Llama-3.1-70B-Instruct-Turbo
```

## Ollama (`ollama`)

Local models via [Ollama](https://ollama.com). Pull a model first (`ollama pull llama3.2`), point HIM at the Ollama host.

```
AI_PROVIDER=ollama
OLLAMA_HOST=http://host.docker.internal:11434   # or http://<host-ip>:11434
AI_MODEL=llama3.2
```

**Recommended models** for incident management (trade off capability vs. memory):
- `llama3.2` — 3B, fast, good enough for clear-cut decisions
- `qwen2.5:14b` — larger, better reasoning
- `mistral-small` — solid middle ground

The smaller the model, the more critical your policy markdown becomes. Local models follow explicit rules better than they handle fuzzy judgment.

## Google Gemini (`gemini`)

Google's API. Has a free tier.

```
AI_PROVIDER=gemini
GEMINI_API_KEY=AIza...
AI_MODEL=gemini-2.5-flash    # default — fast + cheap
```

Get an API key at https://aistudio.google.com/apikey.

## Picking a model

For incident triage the evaluator needs to: read policies, make a categorical decision, output clean JSON. That's well within most mid-tier models' capabilities. Pick based on your preferences around cost, privacy, speed.

## Testing the connection

After setup, hit the detailed health endpoint:

```bash
curl http://localhost:3069/api/health/detailed | jq .integrations.ai_provider
```

Then submit a test incident and watch the logs. If evaluation takes >60s or fails to return JSON, check your model choice — some very small models struggle with structured output.
