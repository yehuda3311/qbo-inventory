import { config } from "../config.js";

const { binId, apiKey, baseUrl } = config.jsonbin;

export const jsonbinService = {
  // Read current inventory from JSONBin
  async getInventory() {
    const res = await fetch(`${baseUrl}/b/${binId}/latest`, {
      headers: {
        "X-Master-Key": apiKey,
        "X-Bin-Meta": "false",
      },
    });

    if (!res.ok) throw new Error(`JSONBin read failed: ${res.status}`);
    return res.json(); // Returns your inventory object
  },

  // Write updated inventory back to JSONBin
  async updateInventory(inventoryData) {
    const res = await fetch(`${baseUrl}/b/${binId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": apiKey,
      },
      body: JSON.stringify(inventoryData),
    });

    if (!res.ok) throw new Error(`JSONBin write failed: ${res.status}`);
    return res.json();
  },

  // Deduct quantities sold from inventory based on invoice line items
  // invoiceLines: array of { itemId, itemName, qty }
  // Returns: { updated: [...], notFound: [...], newInventory }
  async deductSoldItems(invoiceLines) {
    const inventory = await this.getInventory();

    // inventory.products is expected to be an array of:
    // { qboItemId, name, sku, quantity, ... }
    const products = inventory.products || [];
    const updated = [];
    const notFound = [];

    for (const line of invoiceLines) {
      // Match by QBO item ID or name
      const product = products.find(
        (p) => p.qboItemId === line.itemId || p.name === line.itemName
      );

      if (!product) {
        notFound.push(line);
        continue;
      }

      const prevQty = product.quantity;
      product.quantity = Math.max(0, product.quantity - line.qty);
      updated.push({
        name: product.name,
        qboItemId: line.itemId,
        prevQty,
        deducted: line.qty,
        newQty: product.quantity,
      });
    }

    // Persist updated inventory
    inventory.products = products;
    inventory.lastSyncedAt = new Date().toISOString();
    await this.updateInventory(inventory);

    return { updated, notFound, newInventory: inventory };
  },
};
