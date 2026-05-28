import { qboService } from "./services/qbo.js";
import { jsonbinService } from "./services/jsonbin.js";
import { loadTokens } from "./routes/auth.js";

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const JSONBIN_API = "https://api.jsonbin.io/v3";

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
  } catch (e) { console.error("Error saving processed invoice:", e); }
}

async function pollPaidInvoices() {
  console.log(`[Poller] ${new Date().toISOString()} — checking for paid invoices...`);
  try {
    const stored = await loadTokens();
    if (!stored?.qboTokens) {
      console.log("[Poller] No QBO tokens — skipping");
      return;
    }

    // QBO requires date in format: YYYY-MM-DDTHH:MM:SS
    const sinceDate = new Date(Date.now() - 10 * 60 * 1000);
    const since = sinceDate.toISOString().replace(/\.\d{3}Z$/, '');

    const data = await qboService.queryInvoices(stored, `WHERE Balance = '0' AND MetaData.LastUpdatedTime > '${since}'`);
    const invoices = data?.QueryResponse?.Invoice || [];

    if (!invoices.length) {
      console.log("[Poller] No newly paid invoices found");
      return;
    }

    const processed = await getProcessedInvoices();
    let deducted = 0;

    for (const inv of invoices) {
      if (processed.has(inv.Id)) {
        console.log(`[Poller] Invoice ${inv.DocNumber} already processed — skipping`);
        continue;
      }

      console.log(`[Poller] Processing paid invoice ${inv.DocNumber} (ID: ${inv.Id})`);

      const lines = (inv.Line || [])
        .filter(l => l.DetailType === "SalesItemLineDetail")
        .map(l => ({
          itemId: l.SalesItemLineDetail?.ItemRef?.value,
          itemName: l.SalesItemLineDetail?.ItemRef?.name,
          qty: l.SalesItemLineDetail?.Qty || 0,
        }))
        .filter(l => l.itemId && l.qty > 0);

      if (!lines.length) continue;

      const result = await jsonbinService.deductSoldItems(lines);
      console.log(`[Poller] Deducted for invoice ${inv.DocNumber}:`, result.updated);
      await saveProcessedInvoice(inv.Id);
      deducted++;
    }

    console.log(`[Poller] Done — ${deducted} invoices deducted`);
  } catch (err) {
    console.error("[Poller] Error:", err.message);
  }
}

export function startPoller() {
  console.log(`[Poller] Starting — will poll every ${POLL_INTERVAL_MS / 60000} minutes`);
  setTimeout(pollPaidInvoices, 30000);
  setInterval(pollPaidInvoices, POLL_INTERVAL_MS);
}
