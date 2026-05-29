import { Router } from "express";
import { jsonbinService } from "../services/jsonbin.js";

export const inventoryRouter = Router();

inventoryRouter.get("/", async (req, res) => {
  try {
    const data = await jsonbinService.getInventory();
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

inventoryRouter.put("/", async (req, res) => {
  try {
    const result = await jsonbinService.updateInventory(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

inventoryRouter.post("/deduct", async (req, res) => {
  const { lines } = req.body;
  if (!lines?.length) return res.status(400).json({ error: "lines required" });
  try {
    const result = await jsonbinService.deductSoldItems(lines);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
