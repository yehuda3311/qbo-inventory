import { qboService } from "./services/qbo.js";
import { jsonbinService } from "./services/jsonbin.js";
import { loadTokens } from "./routes/auth.js";

const POLL_INTERVAL_MS = 30 * 1000;
const JSONBIN_API = "https://api.jsonbin.io/v3";

const SERVER_START_TIME = new Date().toISOString().replace(/\.\d{3}Z$/, '');
console.log(`[Poller] Will only process invoices created/paid after: ${SERVER_START_TIME}`);

async function getProcessedInvoices() {
  try {
    const binId = process.env.JSONBIN_BIN_ID;
    const apiKey = process.env.JSONBIN_API_KEY;
    const r = await fetch(`${JSONBIN_API}/b/${binId}/latest`, {
      headers: { "X-Master-Key": apiKey, "X-Bin-Meta": "false" }
    });
    const data = await r.json();
    return new Set(data?.processedInvoices || []);
  } catch { return new Set(); }
}

async function saveProcessedInvoice(invoiceId) {
  try {
    const binId = process.env.JSONBIN_BIN_ID;
    const apiKey = process.env.JSONBIN_API_KEY;
    const r = await fetch(`${JSONBIN_API}/b/${binId}/latest`, {
      headers: { "X-Master-Key": apiKey, "X-Bin-Meta": "false" }
    });
    const data = await r.json();
    const processed = data?.processedInvoices || [];
    if (!processed.includes(invoiceId)) {
      processed.push(invoiceId);
      if (processed.length > 1000) processed.splice(0, processed.length - 1000);
      data.processedInvoices = processed;
      await fetch(`${JSONBIN_API}/b/${binId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Master-Key": apiKey },
        body: JSON.stringify(data)
      });
    }
  } catch (e) { console.error("[Poller] Error saving processed invoice:", e); }
}

async function pollPaidInvoices() {
  console.log(`[Poller] ${new Date().toISOString()} checking...`);
  try {
    const stored = await loadTokens();
    if (!stored?.qboTokens) {
      console.log("[Poller] No QBO tokens — skipping");
      return;
    }

    // Query by CreateTime so we catch $0 invoices that are paid at creation
    const data = await qboService.queryInvoices(stored, `WHERE Balance = '0' AND MetaData.CreateTime > '${SERVER_START_TIME}'`);
    const invoices = data?.QueryResponse?.Invoice || [];
    console.log(`[Poller] Found ${invoices.length} paid invoices since server start`);

    if (!invoices.length) return;

    const processed = await getProcessedInvoices();
    let deducted = 0;

    for (const inv of invoices) {
      if (processed.has(inv.Id)) {
        console.log(`[Poller] Skipping already-processed invoice ${inv.DocNumber}`);
        continue;
      }

      console.log(`[Poller] NEW: Invoice ${inv.DocNumber} (ID: ${inv.Id}) — deducting`);

      const lines = (inv.Line || [])
        .filter(l => l.DetailType === "SalesItemLineDetail")
        .map(l => ({
          itemId: l.SalesItemLineDetail?.ItemRef?.value,
          itemName: l.SalesItemLineDetail?.ItemRef?.name,
          qty: l.SalesItemLineDetail?.Qty || 0,
        }))
        .filter(l => l.itemId && l.qty > 0);

      if (!lines.length) {
        await saveProcessedInvoice(inv.Id);
        continue;
      }

      const result = await jsonbinService.deductSoldItems(lines);
      console.log(`[Poller] Deducted:`, JSON.stringify(result.updated));
      await saveProcessedInvoice(inv.Id);
      deducted++;
    }

    if (deducted > 0) {
      console.log(`[Poller] Done — ${deducted} new invoice(s) processed`);
    }
  } catch (err) {
    console.error("[Poller] Error:", err.message);
  }
}

export function startPoller() {
  console.log(`[Poller] Starting — polling every ${POLL_INTERVAL_MS / 1000} seconds`);
  setTimeout(pollPaidInvoices, 5000);
  setInterval(pollPaidInvoices, POLL_INTERVAL_MS);
}
