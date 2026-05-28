import { config } from "../config.js";

function getBinConfig() {
  return {
    binId: process.env.JSONBIN_BIN_ID,
    apiKey: process.env.JSONBIN_API_KEY,
    baseUrl: "https://api.jsonbin.io/v3",
  };
}

export const jsonbinService = {
  async getInventory() {
    const { binId, apiKey, baseUrl } = getBinConfig();
    const res = await fetch(`${baseUrl}/b/${binId}/latest`, {
      headers: { "X-Master-Key": apiKey, "X-Bin-Meta": "false" },
    });
    if (!res.ok) throw new Error(`JSONBin read failed: ${res.status}`);
    return res.json();
  },

  async updateInventory(inventoryData) {
    const { binId, apiKey, baseUrl } = getBinConfig();
    const res = await fetch(`${baseUrl}/b/${binId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Master-Key": apiKey },
      body: JSON.stringify(inventoryData),
    });
    if (!res.ok) throw new Error(`JSONBin write failed: ${res.status}`);
    return res.json();
  },

  async deductSoldItems(invoiceLines) {
    const inventory = await this.getInventory();
    const updated = [];
    const notFound = [];

    // Search across all brands (kratom, kava) and legacy keys
    const brands = ["kratom", "kava", "kratomyx", "kavana"];

    for (const line of invoiceLines) {
      let matched = false;

      for (const brand of brands) {
        const products = inventory?.state?.[brand]?.products || [];
        const product = products.find(
          (p) =>
            p.qboItemId === line.itemId ||
            p.qboItemId === String(line.itemId) ||
            (p.name && p.name.toLowerCase() === (line.itemName || "").toLowerCase())
        );

        if (product) {
          const prevQty = product.qty || 0;
          product.qty = Math.max(0, prevQty - line.qty);
          updated.push({
            name: product.name,
            brand,
            qboItemId: line.itemId,
            prevQty,
            deducted: line.qty,
            newQty: product.qty,
          });
          matched = true;
          break;
        }
      }

      if (!matched) {
        notFound.push(line);
      }
    }

    inventory.lastSyncedAt = new Date().toISOString();
    await this.updateInventory(inventory);

    return { updated, notFound, newInventory: inventory };
  },
};
