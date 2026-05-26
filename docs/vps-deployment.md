# VPS Deployment Guide

Deploy the x402 Cardano Payment Facilitator (with live demo landing page) to a VPS (Hetzner, DigitalOcean, etc.).

## Requirements

- VPS with 1GB+ RAM, Ubuntu 22.04/24.04
- Docker + Docker Compose v2
- A domain name pointed at the server (optional but recommended for TLS)
- Blockfrost Preview testnet API key
- Funded Cardano preview testnet wallet (24-word seed phrase)

## 1. Provision the server

Minimum spec: **Hetzner CX22** (2 vCPU, 4GB RAM, ~€4/mo) or **DO Basic Droplet** (1GB RAM, $6/mo).

```bash
# On your local machine — copy SSH key
ssh-copy-id root@YOUR_SERVER_IP
ssh root@YOUR_SERVER_IP
```

## 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable docker
# Add your user to the docker group if not root
usermod -aG docker $USER
```

## 3. Clone the repo

```bash
git clone https://github.com/MorganOnCode/cardano402.git
cd cardano402
```

## 4. Create config

```bash
cp config/config.example.json config/config.json
nano config/config.json
```

Set these fields:
- `chain.blockfrost.projectId` — your Blockfrost Preview project ID
- `chain.facilitator.seedPhraseFile` — `0600` file containing the 24-word seed phrase for a funded wallet
- `chain.redis.host` → `"redis-prod"` (production Docker service name)
- `chain.redis.password` → same value as `REDIS_PASSWORD` in `.env`
- `logging.level` → `"info"` (not `"debug"` in production)
- `logging.pretty` → `false`
- `server.trustProxy` → numeric hop count when nginx/Cloudflare is the only
  public path (`1` for nginx only, `2` for Cloudflare plus nginx)
- `env` → `"production"`

Production Compose mounts `./secrets` read-only at `/run/secrets`. Create the
files referenced by `config/config.json` before starting the stack:

```bash
mkdir -p secrets
nano secrets/cardano402-facilitator.seed
chmod 600 secrets/cardano402-facilitator.seed
```

If the `demo` section remains enabled, create the separate Preview/Preprod demo
seed file referenced by `demo.seedPhraseFile`, or remove the `demo` section.

```bash
cp .env.example .env
nano .env   # set REDIS_PASSWORD to a strong random string
```

## 5. Deploy

```bash
bash deploy.sh
```

This builds the image, starts Redis + facilitator, and tails logs.

## 6. Verify

```bash
curl http://localhost:3000/health
curl http://localhost:3000/         # landing page
```

## 7. Expose publicly (nginx + TLS)

Install nginx and certbot:

```bash
apt install -y nginx certbot python3-certbot-nginx
```

Create `/etc/nginx/sites-available/x402`:

```nginx
server {
    server_name YOUR_DOMAIN;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        # Required for SSE (demo streaming)
        proxy_buffering off;
        proxy_read_timeout 300s;
        chunked_transfer_encoding on;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/x402 /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Get TLS certificate
certbot --nginx -d YOUR_DOMAIN
```

## 8. Ongoing updates

```bash
cd cardano402
bash deploy.sh   # pulls git + rebuilds + restarts
```

## Security notes

- `config/config.json` is mounted read-only and never in git
- `secrets/` is mounted read-only at `/run/secrets`, ignored by git, and backed
  up only through encrypted restic snapshots
- Redis requires a password in production
- Production Compose fails fast if `REDIS_PASSWORD` is unset and binds the
  facilitator and Redis ports to `127.0.0.1` for nginx/local access only
- The facilitator root filesystem is read-only in production; mutable uploaded
  file storage is limited to the explicit `./data:/app/data` mount and `/tmp`
  tmpfs
- `server.trustProxy` should stay numeric and enabled only behind the loopback
  nginx/Cloudflare path so rate limits use real client IPs without trusting
  arbitrary direct traffic headers
- The facilitator runs as a non-root user inside the container
- Demo wallet seed material must use `demo.seedPhraseFile` in production and
  the file must be `0600`
- The demo wallet pays to itself on testnet; never use a mainnet wallet for the
  demo
