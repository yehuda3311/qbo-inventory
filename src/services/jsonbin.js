function getBinConfig() {
  return {
    binId: process.env.JSONBIN_BIN_ID,
    apiKey: process.env.JSONBIN_API_KEY,
    baseUrl: "https://api.jsonbin.io/v3",
  };
}

export const jsonbinService = {
  async getRawData() {
    const { binId, apiKey, baseUrl } = getBinConfig();
    const res = await fetch(`${baseUrl}/b/${binId}/latest`, {
      headers: {
        "X-Master-Key": apiKey,
        "X-Bin-Meta": "false"
      }
    });
    if (!res.ok) throw new Error(`JSONBin read failed: ${res.status}`);
    const data = await res.json();
    const qty = data?.state?.kratom?.products?.find(p => p.qboItemId === "1010000301")?.qty;
    console.log(`[JSONBin] Read qty for 1 Gallon Kratom Extract: ${qty}`);
    return data;
  },

  async writeRawData(data) {
    const { binId, apiKey, baseUrl } = getBinConfig();
    const res = await fetch(`${baseUrl}/b/${binId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": apiKey
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`JSONBin write failed: ${res.status}`);
    const result = await res.json();
    const qty = result?.record?.state?.kratom?.products?.find(p => p.qboItemId === "1010000301")?.qty;
    console.log(`[JSONBin] Write confirmed qty: ${qty}`);
    return result;
  },

  async getInventory() {
    return this.getRawData();
  },

  async updateInventory(data) {
    return this.writeRawData(data);
  },

  async deductSoldItems(invoiceLines) {
    const data = await this.getRawData();
    const updated = [];
    const notFound = [];
    const brands = ["kratom", "kava", "kratomyx", "kavana"];

    for (const line of invoiceLines) {
      let matched = false;
      for (const brand of brands) {
        const products = data?.state?.[brand]?.products || [];
        const product = products.find(
          (p) =>
            p.qboItemId === line.itemId ||
            p.qboItemId === String(line.itemId) ||
            (p.name && p.name.toLowerCase() === (line.itemName || "").toLowerCase())
        );
        if (product) {
          const prevQty = product.qty || 0;
          product.qty = Math.max(0, prevQty - line.qty);
          console.log(`[JSONBin] Deducting ${line.qty} from ${product.name}: ${prevQty} -> ${product.qty}`);
          updated.push({ name: product.name, brand, qboItemId: line.itemId, prevQty, deducted: line.qty, newQty: product.qty });
          matched = true;
          break;
        }
      }
      if (!matched) notFound.push(line);
    }

    data.lastSyncedAt = new Date().toISOString();
    await this.writeRawData(data);

    return { updated, notFound, newInventory: data };
  },
};
