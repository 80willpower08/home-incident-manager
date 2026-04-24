# Deployment

HIM is a Node.js app plus a SQLite database. The recommended path is Docker, but it'll run anywhere Node 20+ runs.

## Docker (recommended)

Simplest. The published image on Docker Hub is `80willpower08/him-home-incident-manager`, or you can build locally.

### Docker Compose

`docker-compose.yml` in the repo root:

```yaml
services:
  him:
    image: 80willpower08/him-home-incident-manager:latest
    # OR build locally:
    # build: .
    container_name: him
    restart: unless-stopped
    ports:
      - "3069:3069"
    env_file:
      - .env
    volumes:
      - ./data:/data
```

```bash
cp .env.example .env
# edit .env
docker compose up -d
```

Data persists in `./data` — the SQLite file and (if using the Claude CLI provider) the Claude OAuth credentials.

### Building locally

```bash
docker build -t him .
docker run -d --name him --env-file .env -p 3069:3069 -v $(pwd)/data:/data him
```

### First-time Claude CLI authentication (containerized)

The container ships with `claude` installed. If `AI_PROVIDER=claude-cli`, run once:

```bash
docker exec -it him claude
# inside Claude: /login, paste URL in browser, paste code back, Ctrl+D to exit
```

Credentials live in `/data/home/.claude/` and survive restarts/updates.

## TrueNAS Scale (Fangtooth+)

Works as a **Custom App**. See the in-app wizard:

- Image: `80willpower08/him-home-incident-manager:latest`
- Pull policy: Always
- Container port: `3069`, Node port: anything free (e.g. `3069`)
- Environment variables: whatever you'd put in `.env`
- Storage: one mount, host path `/mnt/<pool>/apps/him/data` → container `/data`
- Resources: CPU `1`, Memory `512Mi`. **Do NOT leave memory unbounded — set a limit.**

## Unraid

Community App template: TODO (contributions welcome).

Manual setup via Unraid's Docker UI:
- Repository: `80willpower08/him-home-incident-manager:latest`
- Network Type: `bridge`
- Port: `3069:3069`
- Volume: `/mnt/user/appdata/him:/data`
- Environment variables: add each from `.env.example` as needed

## Synology

Docker add-on from Package Center. Same pattern as Unraid — image, port, volume, env vars.

## Bare Linux (systemd)

```bash
# On the server
git clone https://github.com/80willpower08/home-incident-manager.git /opt/him
cd /opt/him
npm install --omit=dev
cp .env.example .env
# edit /opt/him/.env

# If using AI_PROVIDER=claude-cli:
npm install -g @anthropic-ai/claude-code
claude       # /login once

# systemd unit
sudo tee /etc/systemd/system/him.service <<'EOF'
[Unit]
Description=Home Incident Manager
After=network.target

[Service]
Type=simple
User=him
WorkingDirectory=/opt/him
EnvironmentFile=/opt/him/.env
ExecStart=/usr/bin/node /opt/him/src/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo useradd -r -s /bin/false -d /opt/him him
sudo chown -R him:him /opt/him
sudo systemctl daemon-reload
sudo systemctl enable --now him
```

## Reverse proxy / HTTPS

HIM speaks plain HTTP. Put it behind a reverse proxy for TLS.

### Caddy

```
incidents.example.com {
  reverse_proxy localhost:3069
}
```

### nginx

```
server {
  listen 443 ssl;
  server_name incidents.example.com;
  # ssl_certificate ... / ssl_certificate_key ...

  location / {
    proxy_pass http://localhost:3069;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

### Cloudflare Tunnel

Add a public hostname in your tunnel pointing to `http://<host-ip>:3069`. Cloudflare handles TLS. If your Home Assistant is also on a Cloudflare Tunnel, both can share the same tunnel.

## Access control options

HIM has a few layers you can stack:

1. **HA token auth** — set `HA_URL` and each user generates their own HA long-lived token (this is the built-in mechanism)
2. **Reverse proxy allowlist** — restrict by IP / LAN / VPN
3. **Cloudflare Access** — email-based SSO in front of the tunnel
4. **WAF Referer rules** — only allow requests from your HA iframe (covered in `docs/integrations.md`)

For a home lab behind a VPN, just #1 is usually enough.

## Upgrading

```bash
docker compose pull
docker compose up -d
```

Data in the `/data` volume persists. Migrations run automatically on startup.

## Backups

Back up the `/data` directory. That's everything — SQLite DB (incidents, categories, policies, audit log, settings) plus any Claude OAuth state.
