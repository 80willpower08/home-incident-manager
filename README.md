# HIM — Home Incident Manager

An AI-powered incident management system for your home lab. Household members submit issues through a friendly web UI (or Home Assistant panel), an AI model evaluates each one against your policies, and either auto-resolves common problems (with admin approval or full autonomy) or escalates to you for a manual fix.

## Why

Your family doesn't care about `404`s on `doubleclick.net` or a Plex subtitle sync bug — they just want things to work. HIM gives them a "Submit an issue" button, lets an AI do the first-level triage, and only pages you when something actually needs you. You configure the policies once (as markdown docs) and pick how aggressive the auto-execution should be per category.

## Features

- **Works with any AI**: Claude Code CLI, Anthropic API, OpenAI-compatible endpoints, Ollama (local models), Google Gemini
- **Real identity via Home Assistant**: household members authenticate through HA long-lived tokens; admin role mirrors HA
- **Push notifications to specific devices**: per-user HA notify targets, admin events to admin's phone, resolutions to the submitter's phone
- **Editable categories and policies**: admin UI for adding new incident categories and writing policy documents in markdown
- **Recommend-first, auto-act when ready**: every category starts in "Claude recommends, admin approves" mode; flip the toggle per category once you trust the AI
- **Auto-escalation**: incidents stuck awaiting approval auto-escalate after a configurable timeout
- **Built-in integrations**: Pi-hole v6 (DNS blocking), Plex (stream diagnostics), Network (ping/DNS/traceroute). BlueIris scaffold for future work.
- **Re-evaluation with context**: admin adds a comment, clicks "Re-evaluate with Claude" — the AI reconsiders with the new info
- **Single static binary-ish**: Node.js + SQLite. No Postgres, no Redis, no Kafka. Fits in 256 MB of RAM.

## Screenshots

TODO — add screenshots of the user view, admin queue, and policy editor.

## Quick start (Docker)

```bash
git clone https://github.com/80willpower08/home-incident-manager.git him
cd him
cp .env.example .env
# edit .env — at minimum set AI_PROVIDER and the matching credentials
docker compose up -d
# visit http://localhost:3069
```

You'll see an "Authentication required" gate because HA auth isn't wired yet. See [docs/configuration.md](docs/configuration.md) for your options — the simplest path for pure-local use is to disable auth temporarily by leaving `HA_URL` unset.

## Documentation

- [docs/deployment.md](docs/deployment.md) — TrueNAS, Unraid, Synology, bare Linux, reverse proxy / Cloudflare Tunnel
- [docs/configuration.md](docs/configuration.md) — every env var explained with examples
- [docs/ai-providers.md](docs/ai-providers.md) — setup per provider (Claude, OpenAI, Ollama, Gemini, local models)
- [docs/integrations.md](docs/integrations.md) — Pi-hole, Plex, Home Assistant, BlueIris
- [docs/policies.md](docs/policies.md) — writing good policy docs for the AI

## Architecture

```
┌──────────────┐      ┌──────────────────┐      ┌──────────────┐
│ Household    │──────▶ HIM (Node+SQLite)│──────▶ AI provider  │
│ via HA panel │      │  recommends/acts │      │ (any)        │
└──────────────┘      └────┬─────────────┘      └──────────────┘
                           │
                           ▼
                  ┌──────────────────┐
                  │ Service modules  │
                  │ pihole/plex/etc. │
                  └──────────────────┘
```

- **Web UI** — static HTML/CSS/JS served by Express (dark + light themes)
- **REST API** — `/api/incidents`, `/api/categories`, `/api/settings`, `/api/audit`
- **Auth** — optional Home Assistant WebSocket token validation via `auth/current_user`; admin role from HA
- **AI evaluator** — pluggable. Every evaluator exports the same `evaluate(prompt)` interface
- **Service modules** — opt-in, each category maps to a handler or to a generic fallback
- **Persistence** — single SQLite file with WAL

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE).
