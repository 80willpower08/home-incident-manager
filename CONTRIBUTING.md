# Contributing to HIM

Thanks for considering a contribution. This is a small project — straightforward changes and issue reports are always welcome.

## Ground rules

- **One concern per PR.** Smaller is better.
- **No secrets in commits.** `.env`, tokens, API keys, domain names of your personal setup. `.env.example` uses placeholders only.
- **Match the existing style.** JavaScript, vanilla HTML/CSS/JS for the frontend, no frameworks.
- **Test what you change.** Spin up locally, exercise the path end-to-end.

## Development setup

```bash
git clone https://github.com/80willpower08/home-incident-manager.git
cd home-incident-manager
npm install
cp .env.example .env       # fill in AI provider config
npm run dev                # starts on :3069 with --watch
```

## Where things live

```
src/
  server.js             — Express entry point
  db.js                 — SQLite schema + migrations + seeds
  claude.js             — orchestrator (builds prompts, runs evaluations, executes actions)
  evaluators/           — AI provider adapters (one file per provider)
  services/             — integration modules (pihole, plex, etc.)
  routes/               — Express routes
  middleware/auth.js    — HA token validation
  escalation.js         — background job for auto-escalation
  notifications.js      — HA push notifications
public/
  index.html            — single-page frontend (dark + light themes, admin + user views)
docs/
  *.md                  — deployment, configuration, integrations, providers
```

## Adding an AI provider

1. Create `src/evaluators/yourprovider.js` exporting `evaluate(prompt)` and `describeModel()`
2. Register it in `src/evaluators/index.js`
3. Add env-var docs to `.env.example` and `docs/ai-providers.md`
4. Test a full incident cycle with `AI_PROVIDER=yourprovider`

## Adding an integration

1. Create `src/services/yourservice.js` exporting `diagnose(incident)`, `act(incident, evaluation)`, and `isConfigured()`
2. Register it in `src/services/index.js`'s `MODULES` object
3. Add config to `.env.example` and `docs/integrations.md`
4. Add a default category in `src/db.js` `seedDefaults()` with `service_module: 'yourservice'`

## Reporting security issues

Please don't open a public issue for security concerns. Email or DM the maintainer instead.
