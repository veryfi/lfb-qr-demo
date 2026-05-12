# Veryfi LFB Demo

A standalone vanilla JS demo for the Veryfi Lens for Browser (LFB) capture flow: QR generation, mobile scanning, and webhook-based result delivery.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Vite Dev    │────>│  Express API │────>│  LFB Backend │
│  :3060       │     │  :3061       │     │  (generate_qr)│
│  (frontend)  │     │  (proxy)     │     └──────────────┘
└──────────────┘     │              │
                     │  /api/webhook│<──── Veryfi webhook
                     │  /api/sse    │      (via ngrok)
                     └──────────────┘
```

- **Vite** serves the frontend on `:3060` and proxies `/api/*` to the Express server.
- **Express** on `:3061` handles QR generation (proxied to LFB), receives webhooks, fetches full document details from Veryfi API, and pushes results to the frontend via SSE.

## Setup

1. **Install dependencies:**

```bash
cd lfb-demo
npm install
```

2. **Configure `.env`:**

```env
CLIENT_ID=your_client_id
USERNAME=your_username
API_KEY=your_api_key
LFB_BASE_URL=https://lens.veryfi.com
API_PORT=3061
```

3. **Start the dev servers:**

```bash
npm run dev
```

This starts both Vite (`:3060`) and the Express API server (`:3061`).

4. **Expose webhook with ngrok:**

The Express API server receives webhooks on port `3061`. To make it reachable from the internet, use [ngrok](https://ngrok.com/):

```bash
ngrok http 3061
```

ngrok will output a forwarding URL like:

```
Forwarding  https://a1b2c3d4.ngrok-free.app -> http://localhost:3061
```

Your webhook URL is:

```
https://a1b2c3d4.ngrok-free.app/api/webhook
```

Set this URL as the webhook destination in your Veryfi account:

1. Go to [app.veryfi.com](https://app.veryfi.com).
2. Navigate to **Settings** > **Keys** > **Webhook URL**.
3. Paste `https://<your-ngrok-id>.ngrok-free.app/api/webhook` and save.

You can verify the webhook endpoint is reachable by running:

```bash
curl -X POST https://<your-ngrok-id>.ngrok-free.app/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"event":"test","data":{"id":123}}'
```

You should see `{"status":"ok"}` in the response and a log line in the Express server terminal.

> **Note:** Each time you restart ngrok, the URL changes (unless you have a paid plan with a fixed subdomain). Remember to update the webhook URL in Veryfi when that happens.

## Flow

1. Configure capture mode, optional blueprint, and external ID.
2. Click **Generate QR Code** — calls `/api/generate-qr` which proxies to LFB.
3. Scan the QR with your phone — opens the capture interface.
4. After the phone submits a document, Veryfi sends a webhook to `/api/webhook`.
5. The server fetches full document details, matches by `external_id`, and pushes results via SSE.
6. The frontend replaces the QR code with a green checkmark and the full document JSON.
