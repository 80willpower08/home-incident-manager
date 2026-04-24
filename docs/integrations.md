# Integrations

HIM's core is standalone — it can manage incidents with just an AI provider. Every external integration is **optional** and degrades gracefully if not configured.

## Home Assistant

Used for two things:
1. **Authentication** — household members' HA long-lived tokens act as their identity; HA's admin role determines who sees the Ops view
2. **Push notifications** — admin events go to the admin's phone via HA's mobile app; resolutions go to the submitter's phone

### Auth setup

Set `HA_URL` and every user generates their own long-lived token in HA (Profile → Security → Create Token). Paste the token into the dashboard URL hash: `https://your-him-url/#token=<token>`.

For per-user HA dashboards, see the Home Assistant "Webpage" dashboard type and their built-in per-user visibility settings.

### Notification targets

1. Set `HA_NOTIFY_ADMIN` to your admin user's `notify.X` service name (without `notify.` prefix)
2. Visit Ops → Settings → **Notification Targets** — you'll see a row per unique submitter
3. Fill in their notify service name (e.g. `mobile_app_amandas_iphone`) and hit **Test**

Find service names in HA → Developer Tools → Services → search `notify.`.

### HA REST command (automations file incidents)

Add to HA's `configuration.yaml`:

```yaml
rest_command:
  him_create_incident:
    url: "https://your-him-url/api/incidents"
    method: POST
    headers:
      Authorization: "Bearer <him-user-token>"
      Content-Type: "application/json"
    payload: >
      {
        "title": "{{ title }}",
        "description": "{{ description | default('') }}",
        "type": "{{ type }}",
        "severity": "{{ severity | default('medium') }}"
      }
```

Now any automation can call `service: rest_command.him_create_incident`.

---

## Pi-hole

Currently supports Pi-hole **v6** (the API changed significantly vs v5).

### Config

```
PIHOLE_URL=https://10.0.0.5
PIHOLE_PASSWORD=<web-admin-or-app-password>
```

Set `NODE_TLS_REJECT_UNAUTHORIZED=0` if Pi-hole uses a self-signed cert on LAN.

### What the AI can do

- Look up whether a domain is in the allow/deny list
- Retrieve recent blocked queries for context
- Add a domain to the allow list (exact match)
- Add a domain to the deny list (exact match)
- Deny unblock requests (information-only response)

### App password (recommended)

Create an app password in Pi-hole's web admin instead of using your main admin password. Pi-hole UI → Settings → Web Interface → Application Passwords. This way you can revoke HIM's access without rotating your main password.

---

## Plex

Diagnostic-only for now (checks server status, active sessions, transcoder decisions).

```
PLEX_URL=http://10.0.0.10:32400
PLEX_TOKEN=<your-plex-token>
```

Finding your Plex token: https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/

---

## Network

No configuration needed — uses local `ping`, `nslookup`, and `traceroute`. The container ships with these.

---

## BlueIris

Placeholder. API integration is in progress.

```
BLUEIRIS_URL=http://blueiris.local:81
BLUEIRIS_USER=admin
BLUEIRIS_PASS=...
```

Currently returns "not implemented" and escalates. Contributions welcome.

---

## Adding your own integration

See [CONTRIBUTING.md](../CONTRIBUTING.md#adding-an-integration).

Each service module exports three functions:
- `diagnose(incident)` → `{ summary, ...data }`
- `act(incident, evaluation)` → `{ success, summary, ...result }`
- `isConfigured()` → `boolean`

Register it in `src/services/index.js` and create a default category in `src/db.js` pointing to it.
