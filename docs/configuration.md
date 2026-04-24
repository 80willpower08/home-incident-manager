# Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and edit.

## Minimum viable config

Just an AI provider. HIM will run, you can submit + manage incidents from the web UI, with no auth and no integrations.

```
AI_PROVIDER=claude-cli
```

Visit `http://localhost:3069`. You'll see the auth gate. To disable auth for quick testing, ensure `HA_URL` is unset (see below).

## Server

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `3069` | HTTP listen port |
| `DB_PATH` | `./incident_manager.db` | SQLite file path. Set this when mounting a volume (e.g. `/data/incident_manager.db`) |

## AI provider

See [ai-providers.md](ai-providers.md) for each provider's config.

| Var | Purpose |
|-----|---------|
| `AI_PROVIDER` | One of `claude-cli`, `anthropic`, `openai`, `ollama`, `gemini`. Required. |
| `AI_MODEL` | Model identifier (provider-specific) |
| `AI_TEMPERATURE` | 0 recommended for deterministic triage |
| `AI_MAX_TOKENS` | Response token cap. Default 2048. |

## Home Assistant (auth + notifications)

HA is **optional**. If `HA_URL` is unset, the auth middleware accepts any request (no identity, no admin role) — suitable for local-only, single-user setups. If `HA_URL` is set, HIM validates every request against HA's WebSocket API and enforces admin role from HA's user settings.

| Var | Purpose |
|-----|---------|
| `HA_URL` | Your HA URL (e.g. `https://homeassistant.example.com`). Set to enable auth. |
| `HA_TOKEN` | A long-lived HA token for server-side notifications. Any HA user works. |
| `HA_NOTIFY_ADMIN` | Service name (after `notify.`) for admin push events. E.g. `mobile_app_your_phone`. |

Per-user notification targets are configured in the admin UI (Settings → Notification Targets), not env vars.

## Pi-hole (optional)

Only needed if you want HIM to auto-(un)block domains. Requires Pi-hole v6.

| Var | Purpose |
|-----|---------|
| `PIHOLE_URL` | Base URL (e.g. `https://10.0.0.5`) |
| `PIHOLE_PASSWORD` | Web admin password or an app password (preferred) |

## Plex (optional)

Only needed for Plex diagnostics.

| Var | Purpose |
|-----|---------|
| `PLEX_URL` | e.g. `http://10.0.0.10:32400` |
| `PLEX_TOKEN` | Your Plex auth token |

## BlueIris (optional, placeholder)

Currently a placeholder module. Config is honored if set but no actions execute yet.

| Var |
|-----|
| `BLUEIRIS_URL`, `BLUEIRIS_USER`, `BLUEIRIS_PASS` |

## TLS

| Var | Purpose |
|-----|---------|
| `NODE_TLS_REJECT_UNAUTHORIZED` | Set to `0` if you have self-signed LAN services (Pi-hole, etc.). Do not set in production. |

## Diagnostics

Hit `/api/health/detailed` to see which integrations HIM thinks are configured:

```bash
curl -s http://localhost:3069/api/health/detailed | jq .
```

Response includes a `configured` flag for each integration and the active AI provider + model.
