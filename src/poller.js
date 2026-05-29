import { qboService } from "./services/qbo.js";
import { jsonbinService } from "./services/jsonbin.js";
import { loadTokens } from "./routes/auth.js";

const POLL_INTERVAL_MS = 30 * 1000;
const SERVER_START_DATE = new Date().toISOString().split("T")[0];
const sessionProcessed = new Set();

console.log(`[Poller] Will process invoices from: ${SERVER_START_DATE}`);

async function pollPaidInvoices() {
  try {
    const stored = await loadTokens();
    if (!stored?.qboTokens) { console.log("[Poller] No tokens — skipping"); return; }

    const data = await qboService.queryInvoices(stored, `WHERE Balance = '0' AND TxnDate >= '${SERVER_START_DATE}'`);
    const invoices = data?.QueryResponse?.Invoice || [];
    if (!invoices.length) return;

    // Load processed list from JSONBin
    const bin = await jsonbinService.getInventory();
    const storedProcessed = new Set(bin?.processedInvoices || []);
    for (const id of sessionProcessed) storedProcessed.add(id);

    const newInvoices = invoices.filter(inv => !storedProcessed.has(inv.Id));
    if (!newInvoices.length) return;

    console.log(`[Poller] Found ${newInvoices.length} new paid invoice(s)`);

    // Mark in memory immediately to prevent race
    for (const inv of newInvoices) sessionProcessed.add(inv.Id);

    const newIds = [];
    for (const inv of newInvoices) {
      console.log(`[Poller] Processing invoice #${inv.DocNumber}`);
      const lines = (inv.Line || [])
        .filter(l => l.DetailType === "SalesItemLineDetail")
        .map(l => ({ itemId: l.SalesItemLineDetail?.ItemRef?.value, itemName: l.SalesItemLineDetail?.ItemRef?.name, qty: l.SalesItemLineDetail?.Qty || 0 }))
        .filter(l => l.itemId && l.qty > 0);
      newIds.push(inv.Id);
      if (!lines.length) continue;
      const result = await jsonbinService.deductSoldItems(lines);
      console.log(`[Poller] Deducted:`, JSON.stringify(result.updated));
    }

    // Save processed IDs in one write
    if (newIds.length) {
      const fresh = await jsonbinService.getInventory();
      const processed = fresh?.processedInvoices || [];
      for (const id of newIds) if (!processed.includes(id)) processed.push(id);
      if (processed.length > 1000) processed.splice(0, processed.length - 1000);
      fresh.processedInvoices = processed;
      await jsonbinService.updateInventory(fresh);
    }
  } catch (err) { console.error("[Poller] Error:", err.message); }
}

export function startPoller() {
  console.log(`[Poller] Starting — every ${POLL_INTERVAL_MS / 1000}s`);
  setTimeout(pollPaidInvoices, 5000);
  setInterval(pollPaidInvoices, POLL_INTERVAL_MS);
}
