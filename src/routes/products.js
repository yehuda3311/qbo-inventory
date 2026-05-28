import { Router } from "express";
import { qboService } from "../services/qbo.js";
import { jsonbinService } from "../services/jsonbin.js";
import { writeFile } from "fs/promises";

export const productsRouter = Router();

// GET all inventory items from QBO (for review before import)
productsRouter.get("/qbo", async (req, res) => {
  if (!req.session?.qboTokens) {
    return res.status(401).json({ error: "Not connected to QuickBooks" });
  }
  try {
    const data = await qboService.getItems(req.session);
    const items = data?.QueryResponse?.Item || [];
    res.json({ count: items.length, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST import selected QBO items into inventory (after user review/mapping)
productsRouter.post("/import", async (req, res) => {
  // body: { brand: "kratom"|"kava", items: [{ qboId, name, sku, category, qty, unit, min }] }
  const { brand, items } = req.body;

  if (!brand || !["kratom", "kava"].includes(brand)) {
    return res.status(400).json({ error: "brand must be 'kratom' or 'kava'" });
  }
  if (!items?.length) {
    return res.status(400).json({ error: "items array required" });
  }

  const VALID_CATS = [
    "Bulk Bags",
    "100mg Stickpacks",
    "200mg Stickpacks",
    "Gallons",
    "Shots",
  ];

  try {
    const inventory = await jsonbinService.getInventory();

    // Ensure brand structure exists
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
        // Update existing product's QBO link
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

// Persist tokens to file so webhook handler can use them
productsRouter.post("/save-tokens", async (req, res) => {
  if (!req.session?.qboTokens) {
    return res.status(401).json({ error: "No tokens in session" });
  }
  try {
    await writeFile(
      "./tokens.json",
      JSON.stringify({
        qboTokens: req.session.qboTokens,
        realmId: req.session.realmId,
      })
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
