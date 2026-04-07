import express from "express";
import cors from "cors";
import { EventEmitter } from "events";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const envFile = readFileSync(resolve(__dirname, ".env"), "utf-8");
    for (const line of envFile.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}
loadEnv();

const CLIENT_ID = process.env.CLIENT_ID || "";
const USERNAME = process.env.USERNAME || "";
const API_KEY = process.env.API_KEY || "";
const LFB_BASE_URL = process.env.LFB_BASE_URL;
const API_PORT = parseInt(process.env.API_PORT || "3061", 10);
const VERYFI_API_BASE = "https://api.veryfi.com/api/v8/partner";

const app = express();
app.use(cors());
app.use(express.json());

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

const credentialsMap = new Map();

const EVENT_ENDPOINTS = {
  document: "documents",
  check: "checks",
  anydocument: "any-documents",
};

function getEndpoint(event) {
  const prefix = (event || "").split(".")[0];
  return EVENT_ENDPOINTS[prefix] || "any-documents";
}

// ── Generate QR ──────────────────────────────────────────────────────
app.post("/api/generate-qr", async (req, res) => {
  const { external_id, mode, blueprint, expires_in, base_url } = req.body;

  if (!CLIENT_ID || !USERNAME || !API_KEY) {
    return res.status(500).json({ error: "Missing credentials in .env" });
  }
  if (!LFB_BASE_URL) {
    return res.status(500).json({ error: "LFB_BASE_URL not configured" });
  }

  try {
    const response = await fetch(`${LFB_BASE_URL}/api/generate_qr`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CLIENT-ID": CLIENT_ID,
        AUTHORIZATION: `apikey ${USERNAME}:${API_KEY}`,
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        external_id: external_id || `demo-${Date.now()}`,
        mode: mode || "document",
        ...(blueprint ? { blueprint } : {}),
        expires_in: expires_in || 3600,
        is_async: true,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const detail =
        errorData.error ||
        errorData.message ||
        errorData.detail ||
        JSON.stringify(errorData);
      return res
        .status(response.status)
        .json({ error: `Failed to generate QR: ${detail}`, details: errorData });
    }

    const data = await response.json();
    const resolvedExternalId =
      data.external_id || external_id || `demo-${Date.now()}`;

    credentialsMap.set(resolvedExternalId, {
      clientId: CLIENT_ID,
      username: USERNAME,
      apiKey: API_KEY,
    });

    return res.json(data);
  } catch (err) {
    console.error("[generate-qr] error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ── Webhook receiver ─────────────────────────────────────────────────
app.post("/api/webhook", async (req, res) => {
  const payload = req.body;
  const event = payload.event || "";
  const data = payload.data || payload;
  const documentId = data.id;

  console.log("[webhook] received:", JSON.stringify(payload).slice(0, 200));

  if (!documentId) {
    return res.json({ status: "ok", message: "no document id" });
  }

  try {
    const endpoint = getEndpoint(event);
    let document = null;

    for (const [, creds] of credentialsMap) {
      const url = `${VERYFI_API_BASE}/${endpoint}/${documentId}`;
      const resp = await fetch(url, {
        method: "GET",
        headers: {
          "CLIENT-ID": creds.clientId,
          AUTHORIZATION: `apikey ${creds.username}:${creds.apiKey}`,
        },
      });
      if (resp.ok) {
        document = await resp.json();
        break;
      }
    }

    if (!document) {
      console.error("[webhook] failed to fetch document:", documentId);
      emitter.emit("webhook", {
        session_id: "unknown",
        timestamp: Date.now(),
        payload,
      });
      return res.json({ status: "ok" });
    }

    const externalId =
      document.meta?.external_id || document.external_id || "unknown";

    emitter.emit("webhook", {
      session_id: externalId,
      timestamp: Date.now(),
      payload: document,
    });
  } catch (err) {
    console.error("[webhook] error:", err);
    emitter.emit("webhook", {
      session_id: "unknown",
      timestamp: Date.now(),
      payload,
    });
  }

  return res.json({ status: "ok" });
});

// ── SSE stream ───────────────────────────────────────────────────────
app.get("/api/webhook-events", (req, res) => {
  const externalId = req.query.external_id;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  const onEvent = (event) => {
    if (!externalId || event.session_id === externalId) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  emitter.on("webhook", onEvent);

  req.on("close", () => {
    emitter.off("webhook", onEvent);
  });
});

// ── Health ───────────────────────────────────────────────────────────
app.get("/api/health", (_, res) => {
  res.json({ status: "ok", credentials: !!CLIENT_ID });
});

app.listen(API_PORT, () => {
  console.log(`[lfb-demo] API server running on http://localhost:${API_PORT}`);
  console.log(`[lfb-demo] Webhook URL: http://localhost:${API_PORT}/api/webhook`);
  console.log(`[lfb-demo] Use ngrok to expose: ngrok http ${API_PORT}`);
});
