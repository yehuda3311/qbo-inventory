import { qboService } from "./services/qbo.js";
import { jsonbinService } from "./services/jsonbin.js";
import { loadTokens } from "./routes/auth.js";

const POLL_INTERVAL_MS = 30 * 1000;
const JSONBIN_API = "https://api.jsonbin.io/v3";

const SERVER_START_DATE = new Date().toISOString().split('T')[0];
console.log(`[Poller] Will only process invoices from: ${SERVER_START_DATE}`);

// In-memory set to prevent double-deducting within the same session
const sessionProcessed = new Set();

async function getProcessedInvoices() {
  try {
    const binId = process.env.JSONBIN_BIN_ID;
    const apiKey = process.env.JSONBIN_API_KEY;
    const r = await fetch(`${JSONBIN_API}/b/${binId}/latest`, {
      headers: { "X-Master-Key": apiKey, "X-Bin-Meta": "false" }
    });
    const data = await r.json();
    const stored = new Set(data?.processedInvoices || []);
    // Merge with in-memory set
    for (const id of sessionProcessed) stored.add(id);
    return { stored: data, processedSet: stored };
  } catch { return { stored: null, processedSet: new Set(sessionProcessed) }; }
}

async function saveProcessedInvoices(storedData, newIds) {
  try {
    const binId = process.env.JSONBIN_BIN_ID;
    const apiKey = process.env.JSONBIN_API_KEY;
    const processed = storedData?.processedInvoices || [];
    for (const id of newIds) {
      if (!processed.includes(id)) processed.push(id);
      sessionProcessed.add(id);
    }
    if (processed.length > 1000) processed.splice(0, processed.length - 1000);
    storedData.processedInvoices = processed;
    await fetch(`${JSONBIN_API}/b/${binId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Master-Key": apiKey },
      body: JSON.stringify(storedData)
    });
  } catch (e) { console.error("[Poller] Error saving processed invoices:", e.message); }
}

async function pollPaidInvoices() {
  console.log(`[Poller] ${new Date().toISOString()} checking...`);
  try {
    const stored = await loadTokens();
    if (!stored?.qboTokens) {
      console.log("[Poller] No QBO tokens — skipping");
      return;
    }

    const data = await qboService.queryInvoices(stored, `WHERE Balance = '0' AND TxnDate >= '${SERVER_START_DATE}'`);
    const invoices = data?.QueryResponse?.Invoice || [];
    console.log(`[Poller] Found ${invoices.length} paid invoices for today`);
    if (!invoices.length) return;

    const { stored: binData, processedSet } = await getProcessedInvoices();

    // Filter to only new unprocessed invoices
    const newInvoices = invoices.filter(inv => !processedSet.has(inv.Id));
    if (!newInvoices.length) {
      console.log(`[Poller] All already processed`);
      return;
    }

    console.log(`[Poller] ${newInvoices.length} new invoice(s) to process`);

    // Mark all as processed in memory immediately to prevent race conditions
    for (const inv of newInvoices) sessionProcessed.add(inv.Id);

    const newIds = [];
    let deducted = 0;

    for (const inv of newInvoices) {
      console.log(`[Poller] Processing invoice ${inv.DocNumber} (ID: ${inv.Id})`);
      const lines = (inv.Line || [])
        .filter(l => l.DetailType === "SalesItemLineDetail")
        .map(l => ({
          itemId: l.SalesItemLineDetail?.ItemRef?.value,
          itemName: l.SalesItemLineDetail?.ItemRef?.name,
          qty: l.SalesItemLineDetail?.Qty || 0,
        }))
        .filter(l => l.itemId && l.qty > 0);

      newIds.push(inv.Id);

      if (!lines.length) continue;

      const result = await jsonbinService.deductSoldItems(lines);
      console.log(`[Poller] Deducted:`, JSON.stringify(result.updated));
      deducted++;
    }

    // Save all processed IDs in one single write
    if (newIds.length && binData) {
      await saveProcessedInvoices(binData, newIds);
    }

    console.log(`[Poller] Done — ${deducted} invoice(s) deducted`);
  } catch (err) {
    console.error("[Poller] Error:", err.message);
  }
}

export function startPoller() {
  console.log(`[Poller] Starting — polling every ${POLL_INTERVAL_MS / 1000} seconds`);
  setTimeout(pollPaidInvoices, 5000);
  setInterval(pollPaidInvoices, POLL_INTERVAL_MS);
}
