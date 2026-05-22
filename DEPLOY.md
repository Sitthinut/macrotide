# Deploying Macrotide

Macrotide is a single Next.js process talking to a local SQLite file. There's no separate database service, no message broker, no caching layer to operate — the smallest viable deploy is one Linux VM with Caddy in front for TLS.

If you just want to share the app with people on the public internet, follow the "Single VM" path. If you'd rather keep it on your laptop and tunnel via Tailscale, jump to "Tailnet only".

---

## Single VM (Ubuntu + Caddy)

Tested on Oracle Cloud Ampere (ARM64, 4 vCPU, 24 GB RAM, Ubuntu 24.04) — but any VPS with ≥1 GB RAM and a public IP works.

### 1. Provision the host

```sh
ssh ubuntu@<your-server-ip>
# Update + base packages
sudo apt-get update && sudo apt-get -y full-upgrade
sudo apt-get install -y git build-essential

# Node 24 LTS
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
sudo apt-get install -y nodejs

# Caddy 2.x — automatic HTTPS via Let's Encrypt
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

### 2. Clone + build

```sh
sudo mkdir -p /opt/macrotide && sudo chown $USER:$USER /opt/macrotide
cd /opt/macrotide
git clone https://github.com/<your-fork>/macrotide.git .
npm ci
npm run build
```

### 3. Configure secrets

```sh
cp .env.example .env.local
chmod 600 .env.local
# Edit .env.local — at minimum:
#   PUBLIC_APP_URL=https://macrotide.yourdomain.com
#   AUTH_REQUIRED=1
#   AUTH_SECRET=$(openssl rand -base64 32)
#   OPENROUTER_API_KEY=sk-or-...
#   AI_MODEL=openrouter/auto    (or any model id from openrouter.ai/models)
#   # Optional: separate key for demo chat — see AUTH.md.
#   # DEMO_OPENROUTER_API_KEY=sk-or-...
```

Sign up at [openrouter.ai](https://openrouter.ai) and load a few dollars of credit; that's enough for many weeks of personal use.

### 4. systemd unit

```sh
sudo tee /etc/systemd/system/macrotide.service > /dev/null <<'EOF'
[Unit]
Description=Macrotide
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/macrotide
EnvironmentFile=/opt/macrotide/.env.local
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=10

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/macrotide/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now macrotide
sudo systemctl status macrotide --no-pager
```

The app binds to `127.0.0.1:3000`. Caddy fronts it for TLS.

### 5. Caddy + DNS

Point an A record at the server, then:

```sh
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
macrotide.yourdomain.com {
    encode gzip
    reverse_proxy 127.0.0.1:3000

    # Hide server fingerprint
    header -Server

    # Match Next.js asset caching
    @assets path /_next/static/*
    header @assets Cache-Control "public, max-age=31536000, immutable"
}
EOF
sudo systemctl reload caddy
```

Caddy obtains a Let's Encrypt cert on first request. Verify:

```sh
curl -I https://macrotide.yourdomain.com
# HTTP/2 200, with strict-transport-security header from Macrotide
```

### 6. Firewall

```sh
sudo ufw default deny incoming
sudo ufw allow 22/tcp           # SSH
sudo ufw allow 80,443/tcp       # HTTP+HTTPS (for Caddy)
sudo ufw --force enable
```

### 7. Verify the deploy

```sh
# Open https://macrotide.yourdomain.com — should land on /onboarding
# Sign up + register a passkey from your phone
# Click "Try the demo" from incognito → verify isolated session
```

---

## Tailnet only (Tailscale Serve)

Don't want to deal with public DNS / certs? Bind Macrotide to loopback and serve over Tailscale:

```sh
# Skip Caddy. Same systemd unit binds to 127.0.0.1:3000.
sudo tailscale serve --bg --https=443 http://127.0.0.1:3000
```

The app is now reachable at `https://<machine>.<tailnet>.ts.net` from any tailnet peer. Visitors need Tailscale installed. WebAuthn passkeys still work — `.ts.net` is a valid public origin.

---

## Backups

`data/app.db` is the single source of truth (everything else is config + code).

Macrotide's runtime calls `backupIfStale()` on boot, snapshotting to `data/backups/app-YYYY-MM-DD.db` daily (keeps 30 days). For off-site backup, point restic / borg / rclone at `data/` once a day:

```sh
# /etc/cron.d/macrotide-backup
0 4 * * * ubuntu rclone copy /opt/macrotide/data/backups/ b2:macrotide-backups/ --transfers 4
```

---

## Updating

```sh
cd /opt/macrotide
git pull
npm ci
npm run build
sudo systemctl restart macrotide
```

Migrations run automatically on next request (the singleton DB init applies pending Drizzle migrations).

For a zero-downtime swap behind Caddy: blue/green with two systemd instances on different ports + `caddy reload` between them. Probably overkill until you have actual users.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `503` from Caddy | systemd unit isn't running. `journalctl -u macrotide -n 50`. |
| Passkey "origin mismatch" in browser | `PUBLIC_APP_URL` doesn't match the URL the browser is on. Fix .env.local + restart. |
| `/api/chat` always replies with "isn't configured yet" | `OPENROUTER_API_KEY` is missing or invalid in `.env.local`. Restart the systemd unit after editing. |
| Demo dashboard renders but data is wrong | Cookie collision across browsers. Clear `macrotide_demo` cookie, hit `/onboarding` again. |
| `/api/chat` returns 429 immediately | IP rate limit. The default is 20 RPM; see `lib/api/rate-limit.ts`. |
| Build fails with "out of memory" | ARM64 VMs with <2 GB RAM need a swapfile. `sudo fallocate -l 2G /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`. |

---

## Hardening checklist

Before sharing the URL with anyone:

- [ ] `AUTH_REQUIRED=1` set; passkey works end-to-end on at least two devices
- [ ] `AUTH_SECRET` is a random 32-byte value (never the default placeholder)
- [ ] `DEMO_AI_KEY` is a **separate** key from your owner AI key (avoid quota burn)
- [ ] Demo turn cap (10/session) still in place in `lib/db/demo.ts`
- [ ] Rate limit (`/api/chat` 20 RPM) still in place
- [ ] ufw deny-incoming + 22/80/443 only
- [ ] HTTPS only (Caddy auto-cert + HSTS header)
- [ ] `.env.local` is `chmod 600` and owned by the service user
- [ ] Off-site backup configured (restic / rclone / borg)
- [ ] First demo session works from incognito (proves cookie isolation)
- [ ] Owner data is not visible to a demo session (proves DB context isolation)
