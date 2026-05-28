import { Router } from "express";
import { jsonbinService } from "../services/jsonbin.js";

export const inventoryRouter = Router();

// GET current inventory
inventoryRouter.get("/", async (req, res) => {
  try {
    const inv = await jsonbinService.getInventory();
    res.json(inv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST update full inventory (used by frontend save)
inventoryRouter.put("/", async (req, res) => {
  try {
    const result = await jsonbinService.updateInventory(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST manual deduction (for testing)
inventoryRouter.post("/deduct", async (req, res) => {
  const { lines } = req.body; // [{ itemId, itemName, qty }]
  if (!lines?.length) {
    return res.status(400).json({ error: "lines array required" });
  }
  try {
    const result = await jsonbinService.deductSoldItems(lines);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
