# Cloudflare Tunnel setup (replacing ngrok)

The bridge uses `PUBLIC_BASE_URL` from `.env` for the Bitrix webhook handler URL. Use your Cloudflare Tunnel public URL there.

## 1. Install cloudflared

```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-public-v2.gpg | sudo tee /usr/share/keyrings/cloudflare-public-v2.gpg >/dev/null

echo 'deb [signed-by=/usr/share/keyrings/cloudflare-public-v2.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list

sudo apt-get update && sudo apt-get install cloudflared
```

## 2. Install and run the tunnel as a service

Use the token from your Cloudflare Zero Trust dashboard (Access → Tunnels):

```bash
sudo cloudflared service install YOUR_TUNNEL_TOKEN
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

Or run once in the foreground:

```bash
cloudflared tunnel run --token YOUR_TUNNEL_TOKEN
```

## 3. Configure the tunnel in Cloudflare

In the Cloudflare Zero Trust dashboard, add a **Public Hostname** for the tunnel:

- **Subdomain / hostname:** e.g. `pbx.zweighing.com` (your public URL)
- **Service type:** HTTP
- **Origin / URL:** `http://127.0.0.1:8080` (bridge listens on port 8080 by default)

## 4. Set PUBLIC_BASE_URL in .env

In `/opt/bitrix-asterisk-bridge/.env` add or update (no trailing slash):

```env
PUBLIC_BASE_URL=https://pbx.zweighing.com
```

Copy from `.env.example` if needed: `cp .env.example .env` then edit.

## 5. Restart the bridge

```bash
sudo systemctl restart bitrix-asterisk-bridge
```

## 6. Re-bind Bitrix event (if needed)

If you already had the webhook bound to an old URL, call the bind endpoint once so Bitrix uses the new one:

```bash
curl -sS "https://pbx.zweighing.com/bitrix/bind"
```

(Auth uses the stored Bitrix token from `/bitrix/install` or `/bitrix/save-auth`.)
