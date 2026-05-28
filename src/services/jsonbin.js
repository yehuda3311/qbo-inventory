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
    return res.json(); // Returns the raw record (no wrapper when X-Bin-Meta: false)
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
    const raw = await this.getInventory();
    
    // JSONBin returns { record: {...} } even with X-Bin-Meta: false in some cases
    // Handle both formats
    const inventory = raw?.record ? raw.record : raw;
    
    console.log("[JSONBin] Data structure keys:", Object.keys(inventory));
    console.log("[JSONBin] Has state:", !!inventory?.state);
    console.log("[JSONBin] State keys:", inventory?.state ? Object.keys(inventory.state) : "none");

    const updated = [];
    const notFound = [];
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
      if (!matched) notFound.push(line);
    }

    inventory.lastSyncedAt = new Date().toISOString();
    
    // Write back — if original had record wrapper, preserve full structure
    const toWrite = raw?.record ? { ...raw, record: inventory } : inventory;
    await this.updateInventory(toWrite);

    console.log("[JSONBin] Written back. Updated:", JSON.stringify(updated));

    return { updated, notFound, newInventory: inventory };
  },
};
