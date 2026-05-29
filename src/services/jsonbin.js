const JSONBIN_API = "https://api.jsonbin.io/v3";

function binId() { return process.env.JSONBIN_BIN_ID; }
function apiKey() { return process.env.JSONBIN_API_KEY; }

export const jsonbinService = {
  async getInventory() {
    const r = await fetch(`${JSONBIN_API}/b/${binId()}/latest`, {
      headers: { "X-Master-Key": apiKey(), "X-Bin-Meta": "false" }
    });
    if (!r.ok) throw new Error(`JSONBin read failed: ${r.status}`);
    return r.json();
  },

  async updateInventory(data) {
    const r = await fetch(`${JSONBIN_API}/b/${binId()}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Master-Key": apiKey() },
      body: JSON.stringify(data)
    });
    if (!r.ok) throw new Error(`JSONBin write failed: ${r.status}`);
    return r.json();
  },

  async deductSoldItems(invoiceLines) {
    const data = await this.getInventory();
    const updated = [];
    const notFound = [];
    const brands = ["kratom", "kava", "kratomyx", "kavana"];

    for (const line of invoiceLines) {
      let matched = false;
      for (const brand of brands) {
        const products = data?.state?.[brand]?.products || [];
        const product = products.find(p =>
          p.qboItemId === line.itemId ||
          p.qboItemId === String(line.itemId) ||
          (p.name && p.name.toLowerCase() === (line.itemName || "").toLowerCase())
        );
        if (product) {
          const prevQty = product.qty || 0;
          product.qty = Math.max(0, prevQty - line.qty);
          console.log(`[JSONBin] ${product.name}: ${prevQty} → ${product.qty}`);
          updated.push({ name: product.name, brand, qboItemId: line.itemId, prevQty, deducted: line.qty, newQty: product.qty });
          matched = true;
          break;
        }
      }
      if (!matched) notFound.push(line);
    }

    data.lastSyncedAt = new Date().toISOString();
    await this.updateInventory(data);
    return { updated, notFound };
  },
};
