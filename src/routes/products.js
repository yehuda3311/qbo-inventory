import { Router } from "express";
import { qboService } from "../services/qbo.js";
import { jsonbinService } from "../services/jsonbin.js";
import { loadTokens } from "./auth.js";

export const productsRouter = Router();

const VALID_CATS = ["Bulk Bags", "100mg Stickpacks", "200mg Stickpacks", "Gallons", "Shots"];

productsRouter.get("/qbo", async (req, res) => {
  const stored = await loadTokens();
  if (!stored?.qboTokens) return res.status(401).json({ error: "Not connected to QuickBooks" });
  try {
    const data = await qboService.getItems(stored);
    res.json({ count: data?.QueryResponse?.Item?.length || 0, items: data?.QueryResponse?.Item || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

productsRouter.get("/invoice-debug/:id", async (req, res) => {
  const stored = await loadTokens();
  if (!stored?.qboTokens) return res.status(401).json({ error: "Not connected" });
  try {
    res.json(await qboService.getInvoice(stored, req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

productsRouter.post("/import", async (req, res) => {
  const { brand, items } = req.body;
  if (!brand || !["kratom", "kava"].includes(brand)) return res.status(400).json({ error: "brand must be kratom or kava" });
  if (!items?.length) return res.status(400).json({ error: "items required" });
  try {
    const inventory = await jsonbinService.getInventory();
    if (!inventory.state) inventory.state = {};
    if (!inventory.state[brand]) inventory.state[brand] = { materials: [], products: [], orders: [] };
    let prodIdC = inventory.prodIdC || 1;
    const imported = [], skipped = [];
    for (const item of items) {
      if (!VALID_CATS.includes(item.category)) { skipped.push(item); continue; }
      const existing = inventory.state[brand].products.find(p => p.qboItemId === item.qboId || p.name.toLowerCase() === item.name.toLowerCase());
      if (existing) { existing.qboItemId = item.qboId; imported.push({ ...item, action: "updated" }); }
      else {
        inventory.state[brand].products.push({ id: prodIdC++, qboItemId: item.qboId, name: item.name, cat: item.category, qty: item.qty || 0, unit: item.unit || "units", min: item.min || 0, sku: item.sku || "", notes: "", lead: 0 });
        imported.push({ ...item, action: "created" });
      }
    }
    inventory.prodIdC = prodIdC;
    await jsonbinService.updateInventory(inventory);
    res.json({ imported: imported.length, skipped: skipped.length, imported, skipped });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
