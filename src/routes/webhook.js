import { Router } from "express";
import crypto from "crypto";
import { qboService } from "../services/qbo.js";
import { jsonbinService } from "../services/jsonbin.js";
import { loadTokens } from "./auth.js";
import express from "express";

export const webhookRouter = Router();

// In-memory log of webhook attempts
const webhookLog = [];

// View recent webhook attempts
webhookRouter.get("/log", (req, res) => {
  res.json({ count: webhookLog.length, entries: webhookLog.slice(-20) });
});

// QBO webhook receiver
webhookRouter.post("/qbo", express.raw({ type: "application/json" }), async (req, res) => {
  const entry = {
    time: new Date().toISOString(),
    signature: req.headers["intuit-signature"] || "none",
    bodyPreview: req.body?.toString?.()?.slice(0, 200) || "empty",
  };
  webhookLog.push(entry);
  console.log("Webhook received:", JSON.stringify(entry));

  // Verify signature
  if (process.env.QBO_WEBHOOK_VERIFIER_TOKEN) {
    const signature = req.headers["intuit-signature"];
    const hash = crypto
      .createHmac("sha256", process.env.QBO_WEBHOOK_VERIFIER_TOKEN)
      .update(req.body)
      .digest("base64");
    if (hash !== signature) {
      console.warn("Invalid signature. Expected:", hash, "Got:", signature);
      entry.error = "Invalid signature";
      return res.status(401).json({ error: "Invalid signature" });
    }
  }

  let event;
  try { event = JSON.parse(req.body.toString()); }
  catch { return res.status(400).json({ error: "Invalid JSON" }); }

  res.status(200).json({ received: true });

  try { await processWebhookEvent(event); }
  catch (err) { console.error("Webhook processing error:", err); }
});

// Manual sync by invoice ID
webhookRouter.post("/manual-sync/:invoiceId", async (req, res) => {
  const { invoiceId } = req.params;
  try {
    const stored = await loadTokens();
    if (!stored?.qboTokens) {
      return res.status(401).json({ error: "Not authenticated with QuickBooks" });
    }
    const result = await syncInvoiceToInventory(stored, invoiceId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk sync all paid invoices since a date
webhookRouter.post("/sync-paid-since", async (req, res) => {
  const { since } = req.body;
  try {
    const stored = await loadTokens();
    if (!stored?.qboTokens) {
      return res.status(401).json({ error: "Not authenticated with QuickBooks" });
    }
    const where = since ? `WHERE TxnDate >= '${since}'` : "";
    const data = await qboService.queryInvoices(stored, where);
    const invoices = data?.QueryResponse?.Invoice || [];
    const paid = invoices.filter(inv => inv.Balance === 0);

    const results = [];
    for (const inv of paid) {
      const r = await syncInvoiceToInventory(stored, inv.Id);
      results.push({ invoiceId: inv.Id, docNumber: inv.DocNumber, ...r });
    }

    res.json({ processed: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function processWebhookEvent(event) {
  const entities = event?.eventNotifications?.[0]?.dataChangeEvent?.entities || [];
  console.log("Processing entities:", JSON.stringify(entities));
  for (const entity of entities) {
    if (entity.name !== "Invoice") continue;
    console.log(`Invoice update: ${entity.id}`);
    const stored = await loadTokens();
    if (!stored) { console.error("No stored QBO tokens"); return; }
    await syncInvoiceToInventory(stored, entity.id);
  }
}

async function syncInvoiceToInventory(stored, invoiceId) {
  const data = await qboService.getInvoice(stored, invoiceId);
  const invoice = data?.Invoice;
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

  if (invoice.Balance !== 0) {
    return { skipped: true, reason: `Balance is ${invoice.Balance}, not fully paid` };
  }

  console.log(`Invoice ${invoice.DocNumber} is PAID — deducting inventory`);

  const lines = (invoice.Line || [])
    .filter(l => l.DetailType === "SalesItemLineDetail")
    .map(l => ({
      itemId: l.SalesItemLineDetail?.ItemRef?.value,
      itemName: l.SalesItemLineDetail?.ItemRef?.name,
      qty: l.SalesItemLineDetail?.Qty || 0,
    }))
    .filter(l => l.itemId && l.qty > 0);

  if (!lines.length) {
    return { skipped: true, reason: "No line items on invoice" };
  }

  const result = await jsonbinService.deductSoldItems(lines);
  console.log("Inventory updated:", result.updated);

  return {
    invoiceId,
    docNumber: invoice.DocNumber,
    customerName: invoice.CustomerRef?.name,
    linesProcessed: lines.length,
    ...result,
  };
}
