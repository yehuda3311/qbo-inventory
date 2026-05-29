import { Router } from "express";
import crypto from "crypto";
import { qboService } from "../services/qbo.js";
import { jsonbinService } from "../services/jsonbin.js";
import { loadTokens } from "./auth.js";

export const webhookRouter = Router();

webhookRouter.post("/qbo", async (req, res) => {
  const chunks = [];
  req.on("data", chunk => chunks.push(chunk));
  req.on("end", async () => {
    const rawBody = Buffer.concat(chunks);
    const bodyStr = rawBody.toString();
    console.log("[Webhook] Received:", bodyStr.slice(0, 200));

    if (process.env.QBO_WEBHOOK_VERIFIER_TOKEN) {
      const sig = req.headers["intuit-signature"];
      const hash = crypto.createHmac("sha256", process.env.QBO_WEBHOOK_VERIFIER_TOKEN).update(rawBody).digest("base64");
      if (hash !== sig) { console.warn("[Webhook] Invalid signature"); return res.status(401).json({ error: "Invalid signature" }); }
    }

    let event;
    try { event = JSON.parse(bodyStr); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
    res.status(200).json({ received: true });

    try {
      const entities = event?.eventNotifications?.[0]?.dataChangeEvent?.entities || [];
      for (const entity of entities) {
        if (entity.name !== "Invoice") continue;
        const stored = await loadTokens();
        if (!stored) continue;
        await syncInvoice(stored, entity.id);
      }
    } catch (err) { console.error("[Webhook] Error:", err.message); }
  });
});

webhookRouter.post("/manual-sync/:invoiceId", async (req, res) => {
  const stored = await loadTokens();
  if (!stored?.qboTokens) return res.status(401).json({ error: "Not authenticated" });
  try { res.json(await syncInvoice(stored, req.params.invoiceId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

webhookRouter.post("/sync-paid-since", async (req, res) => {
  const stored = await loadTokens();
  if (!stored?.qboTokens) return res.status(401).json({ error: "Not authenticated" });
  const { since } = req.body;
  try {
    const data = await qboService.queryInvoices(stored, since ? `WHERE TxnDate >= '${since}'` : "");
    const paid = (data?.QueryResponse?.Invoice || []).filter(inv => inv.Balance === 0);
    const results = [];
    for (const inv of paid) results.push(await syncInvoice(stored, inv.Id));
    res.json({ processed: results.length, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function syncInvoice(stored, invoiceId) {
  const data = await qboService.getInvoice(stored, invoiceId);
  const invoice = data?.Invoice;
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
  if (invoice.Balance !== 0) return { skipped: true, reason: `Balance ${invoice.Balance} not zero` };

  const lines = (invoice.Line || [])
    .filter(l => l.DetailType === "SalesItemLineDetail")
    .map(l => ({ itemId: l.SalesItemLineDetail?.ItemRef?.value, itemName: l.SalesItemLineDetail?.ItemRef?.name, qty: l.SalesItemLineDetail?.Qty || 0 }))
    .filter(l => l.itemId && l.qty > 0);

  if (!lines.length) return { skipped: true, reason: "No line items" };
  const result = await jsonbinService.deductSoldItems(lines);
  console.log(`[Webhook] Invoice #${invoice.DocNumber} synced:`, result.updated);
  return { invoiceId, docNumber: invoice.DocNumber, ...result };
}
