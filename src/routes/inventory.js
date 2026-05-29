import { Router } from "express";

export const inventoryRouter = Router();

const JSONBIN_API = "https://api.jsonbin.io/v3";

// GET current inventory — always fresh
inventoryRouter.get("/", async (req, res) => {
  const binId = process.env.JSONBIN_BIN_ID;
  const apiKey = process.env.JSONBIN_API_KEY;
  try {
    const r = await fetch(`${JSONBIN_API}/b/${binId}/latest`, {
      headers: { 
        "X-Master-Key": apiKey, 
        "X-Bin-Meta": "false"
      }
    });
    if (!r.ok) throw new Error(`JSONBin read failed: ${r.status}`);
    const data = await r.json();
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update full inventory
inventoryRouter.put("/", async (req, res) => {
  const binId = process.env.JSONBIN_BIN_ID;
  const apiKey = process.env.JSONBIN_API_KEY;
  try {
    const r = await fetch(`${JSONBIN_API}/b/${binId}`, {
      method: "PUT",
      headers: { 
        "Content-Type": "application/json", 
        "X-Master-Key": apiKey
      },
      body: JSON.stringify(req.body),
    });
    if (!r.ok) throw new Error(`JSONBin write failed: ${r.status}`);
    res.json(await r.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST manual deduction
inventoryRouter.post("/deduct", async (req, res) => {
  const { lines } = req.body;
  if (!lines?.length) return res.status(400).json({ error: "lines array required" });
  try {
    const { jsonbinService } = await import("../services/jsonbin.js");
    const result = await jsonbinService.deductSoldItems(lines);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
