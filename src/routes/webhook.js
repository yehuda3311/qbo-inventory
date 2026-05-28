import { Router } from "express";
import crypto from "crypto";
import { config } from "../config.js";
import { qboService } from "../services/qbo.js";
import { jsonbinService } from "../services/jsonbin.js";

export const webhookRouter = Router();

// QBO sends webhook as raw JSON body — we need the raw bytes for signature verification
webhookRouter.post(
  "/qbo",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    // 1. Verify webhook signature (Intuit-Signature header)
    if (config.webhookVerifierToken) {
      const signature = req.headers["intuit-signature"];
      const payload = req.body; // raw Buffer

      const hash = crypto
        .createHmac("sha256", config.webhookVerifierToken)
        .update(payload)
        .digest("base64");

      if (hash !== signature) {
        console.warn("⚠️  Invalid webhook signature — ignoring");
        return res.status(401).json({ error: "Invalid signature" });
      }
    }

    // 2. Parse the event
    let event;
    try {
      event = JSON.parse(req.body.toString());
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }

    // 3. Acknowledge immediately (QBO retries if no 200 within 5s)
    res.status(200).json({ received: true });

    // 4. Process asynchronously
    try {
      await processWebhookEvent(event);
    } catch (err) {
      console.error("Webhook processing error:", err);
    }
  }
);

// Also expose a manual trigger endpoint for testing
webhookRouter.post("/manual-sync/:invoiceId", async (req, res) => {
  const { invoiceId } = req.params;
  try {
    const result = await syncInvoiceToInventory(req.session, invoiceId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Process all paid invoices since a given date (for catch-up / initial sync)
webhookRouter.post("/sync-paid-since", async (req, res) => {
  const { since } = req.body; // ISO date string, e.g. "2024-01-01"
  try {
    const where = since
      ? `WHERE TxnDate >= '${since}' AND PaymentMethodRef IS NOT NULL`
      : "";
    const data = await qboService.queryInvoices(req.session, where);
    const invoices = data?.QueryResponse?.Invoice || [];
    const paid = invoices.filter((inv) => inv.Balance === 0);

    const results = [];
    for (const inv of paid) {
      const r = await syncInvoiceLineItems(inv);
      results.push({ invoiceId: inv.Id, docNumber: inv.DocNumber, ...r });
    }

    res.json({ processed: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Core processing logic ----

async function processWebhookEvent(event) {
  const entities = event?.eventNotifications?.[0]?.dataChangeEvent?.entities || [];

  for (const entity of entities) {
    if (entity.name !== "Invoice") continue;
    if (entity.operation !== "Update") continue; // We care about updates (payment)

    console.log(`📬 Invoice update detected: ${entity.id}`);

    // Fetch the full invoice from QBO to check if it's paid
    // NOTE: We need stored tokens — for production use a DB, not session
    // Here we read from a token file written during OAuth flow
    const session = await getStoredSession();
    if (!session) {
      console.error("No stored QBO session — cannot process webhook");
      return;
    }

    await syncInvoiceToInventory(session, entity.id);
  }
}

async function syncInvoiceToInventory(session, invoiceId) {
  const data = await qboService.getInvoice(session, invoiceId);
  const invoice = data?.Invoice;

  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

  // Only process fully paid invoices (Balance = 0)
  if (invoice.Balance !== 0) {
    return { skipped: true, reason: `Balance is ${invoice.Balance}, not fully paid` };
  }

  console.log(`💰 Invoice ${invoice.DocNumber} is PAID — deducting inventory`);

  // Extract line items with inventory items
  const lines = (invoice.Line || [])
    .filter((l) => l.DetailType === "SalesItemLineDetail")
    .map((l) => ({
      itemId: l.SalesItemLineDetail?.ItemRef?.value,
      itemName: l.SalesItemLineDetail?.ItemRef?.name,
      qty: l.SalesItemLineDetail?.Qty || 0,
      amount: l.Amount,
    }))
    .filter((l) => l.itemId && l.qty > 0);

  if (!lines.length) {
    return { skipped: true, reason: "No inventory line items on invoice" };
  }

  const result = await jsonbinService.deductSoldItems(lines);

  console.log(`✅ Inventory updated:`, result.updated);
  if (result.notFound.length) {
    console.warn(`⚠️  Items not matched in inventory:`, result.notFound);
  }

  return {
    invoiceId,
    docNumber: invoice.DocNumber,
    customerName: invoice.CustomerRef?.name,
    linesProcessed: lines.length,
    ...result,
  };
}

// Helper: load tokens from file (written during OAuth)
import { readFile } from "fs/promises";
import { existsSync } from "fs";

async function getStoredSession() {
  const tokenPath = "./tokens.json";
  if (!existsSync(tokenPath)) return null;
  try {
    const raw = await readFile(tokenPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Fix: need express for raw middleware
import express from "express";
