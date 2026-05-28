import { Router } from "express";
import { qboService } from "../services/qbo.js";
import { jsonbinService } from "../services/jsonbin.js";
import { loadTokens } from "./auth.js";

export const productsRouter = Router();

const VALID_CATS = ["Bulk Bags","100mg Stickpacks","200mg Stickpacks","Gallons","Shots"];

// Debug — see raw QBO items
productsRouter.get("/qbo-debug", async (req, res) => {
  const stored = await loadTokens();
  if (!stored?.qboTokens) {
    return res.status(401).json({ error: "Not connected to QuickBooks" });
  }
  try {
    const data = await qboService.getItems(stored);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Debug — see raw invoice
productsRouter.get("/invoice-debug/:id", async (req, res) => {
  const stored = await loadTokens();
  if (!stored?.qboTokens) {
    return res.status(401).json({ error: "Not connected to QuickBooks" });
  }
  try {
    const data = await qboService.getInvoice(stored, req.params.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all inventory items from QBO
productsRouter.get("/qbo", async (req, res) => {
  const stored = await loadTokens();
  if (!stored?.qboTokens) {
    return res.status(401).json({ error: "Not connected to QuickBooks" });
  }
  try {
    const data = await qboService.getItems(stored);
    const items = data?.QueryResponse?.Item || [];
    res.json({ count: items.length, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST import selected QBO items into inventory
productsRouter.post("/import", async (req, res) => {
  const { brand, items } = req.body;

  if (!brand || !["kratom", "kava"].includes(brand)) {
    return res.status(400).json({ error: "brand must be 'kratom' or 'kava'" });
  }
  if (!items?.length) {
    return res.status(400).json({ error: "items array required" });
  }

  try {
    const inventory = await jsonbinService.getInventory();

    if (!inventory.state) inventory.state = {};
    if (!inventory.state[brand]) {
      inventory.state[brand] = { materials: [], products: [], orders: [] };
    }

    let prodIdC = inventory.prodIdC || 1;
    const imported = [];
    const skipped = [];

    for (const item of items) {
      if (!VALID_CATS.includes(item.category)) {
        skipped.push({ ...item, reason: `Invalid category: ${item.category}` });
        continue;
      }

      const existing = inventory.state[brand].products.find(
        (p) => p.qboItemId === item.qboId || p.name.toLowerCase() === item.name.toLowerCase()
      );

      if (existing) {
        existing.qboItemId = item.qboId;
        existing.sku = item.sku || existing.sku;
        imported.push({ ...item, action: "updated", id: existing.id });
      } else {
        const newProd = {
          id: prodIdC++,
          qboItemId: item.qboId,
          name: item.name,
          cat: item.category,
          qty: item.qty || 0,
          unit: item.unit || "units",
          min: item.min || 0,
          sku: item.sku || "",
          notes: item.notes || "",
          lead: 0,
        };
        inventory.state[brand].products.push(newProd);
        imported.push({ ...item, action: "created", id: newProd.id });
      }
    }

    inventory.prodIdC = prodIdC;
    await jsonbinService.updateInventory(inventory);

    res.json({ imported: imported.length, skipped: skipped.length, imported, skipped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Debug JSONBin read/write cycle
productsRouter.get("/jsonbin-debug", async (req, res) => {
  const binId = process.env.JSONBIN_BIN_ID;
  const apiKey = process.env.JSONBIN_API_KEY;
  const base = "https://api.jsonbin.io/v3";

  try {
    // Step 1: Read with /latest
    const r1 = await fetch(`${base}/b/${binId}/latest`, { headers: { "X-Master-Key": apiKey, "X-Bin-Meta": "false" } });
    const d1 = await r1.json();
    const qtyBefore = d1?.state?.kratom?.products?.find(p => p.qboItemId === "1010000301")?.qty;

    // Step 2: Read without /latest
    const r2 = await fetch(`${base}/b/${binId}`, { headers: { "X-Master-Key": apiKey, "X-Bin-Meta": "false" } });
    const d2 = await r2.json();
    const qtyBefore2 = d2?.state?.kratom?.products?.find(p => p.qboItemId === "1010000301")?.qty;

    // Step 3: Write qty-1 using d1
    const testQty = (qtyBefore || 10) - 1;
    const prod = d1?.state?.kratom?.products?.find(p => p.qboItemId === "1010000301");
    if (prod) prod.qty = testQty;
    d1.debugWriteAt = new Date().toISOString();

    const w = await fetch(`${base}/b/${binId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Master-Key": apiKey },
      body: JSON.stringify(d1)
    });
    const writeResult = await w.json();
    const qtyInWriteResponse = writeResult?.record?.state?.kratom?.products?.find(p => p.qboItemId === "1010000301")?.qty;

    // Step 4: Read back immediately with /latest
    await new Promise(r => setTimeout(r, 1000)); // wait 1 second
    const r3 = await fetch(`${base}/b/${binId}/latest`, { headers: { "X-Master-Key": apiKey, "X-Bin-Meta": "false" } });
    const d3 = await r3.json();
    const qtyAfter = d3?.state?.kratom?.products?.find(p => p.qboItemId === "1010000301")?.qty;

    res.json({
      step1_read_latest: qtyBefore,
      step2_read_direct: qtyBefore2,
      step3_wrote_qty: testQty,
      step3_write_status: w.status,
      step3_qty_in_response: qtyInWriteResponse,
      step4_read_back_latest: qtyAfter,
      verdict: qtyAfter === testQty ? "✅ Write is sticking" : "❌ Write is NOT sticking"
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
