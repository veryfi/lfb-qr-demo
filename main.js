const $ = (sel) => document.querySelector(sel);

const modeSelect = $("#mode");
const blueprintGroup = $("#blueprint-group");
const blueprintInput = $("#blueprint");
const externalIdInput = $("#external-id");
const expiresInInput = $("#expires-in");
const generateBtn = $("#generate-btn");

const configurePanel = $("#configure-panel");
const qrPanel = $("#qr-panel");
const backBtn = $("#back-btn");

const qrLoading = $("#qr-loading");
const qrError = $("#qr-error");
const qrDisplay = $("#qr-display");
const qrImage = $("#qr-image");
const waitingIndicator = $("#waiting-indicator");

const resultContainer = $("#result-container");
const resultJson = $("#result-json");
const qrContainer = $("#qr-container");

let eventSource = null;
let currentExternalId = "";

modeSelect.addEventListener("change", () => {
  blueprintGroup.style.display =
    modeSelect.value === "anydocs" ? "block" : "none";
});

backBtn.addEventListener("click", () => {
  closeSSE();
  qrPanel.style.display = "none";
  configurePanel.style.display = "block";
  resetQRPanel();
});

generateBtn.addEventListener("click", () => {
  configurePanel.style.display = "none";
  qrPanel.style.display = "block";
  generateQR();
});

function resetQRPanel() {
  qrLoading.style.display = "none";
  qrError.style.display = "none";
  qrDisplay.style.display = "none";
  waitingIndicator.style.display = "none";
  resultContainer.style.display = "none";
  qrContainer.style.display = "flex";
  currentExternalId = "";
}

async function generateQR() {
  resetQRPanel();
  qrLoading.style.display = "flex";

  const body = {
    mode: modeSelect.value,
    expires_in: parseInt(expiresInInput.value, 10) || 3600,
  };

  const extId = externalIdInput.value.trim();
  if (extId) body.external_id = extId;

  const bp = blueprintInput.value.trim();
  if (modeSelect.value === "anydocs" && bp) body.blueprint = bp;

  try {
    const resp = await fetch("/api/generate-qr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }

    const data = await resp.json();

    qrLoading.style.display = "none";
    qrImage.src = data.qr_code_base64;
    qrDisplay.style.display = "flex";

    currentExternalId = data.external_id || extId || "";

    if (currentExternalId) {
      waitingIndicator.style.display = "flex";
      subscribeSSE(currentExternalId);
    }
  } catch (err) {
    qrLoading.style.display = "none";
    qrError.style.display = "block";
    qrError.textContent = err.message;
  }
}

function subscribeSSE(externalId) {
  closeSSE();

  const url = `/api/webhook-events?external_id=${encodeURIComponent(externalId)}`;
  eventSource = new EventSource(url);

  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === "connected") return;

      const payload = data.payload || data;
      showResult(payload);
      closeSSE();
    } catch {}
  };

  eventSource.onerror = () => {
    console.warn("[sse] connection error, retrying...");
  };
}

function closeSSE() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function showResult(payload) {
  qrContainer.style.display = "none";
  waitingIndicator.style.display = "none";
  resultContainer.style.display = "block";
  resultJson.textContent = JSON.stringify(payload, null, 2);
}
