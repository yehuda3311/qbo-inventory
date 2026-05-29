const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

function getBase() {
  return process.env.QBO_ENVIRONMENT === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

export const qboService = {
  async exchangeCodeForTokens(code, realmId) {
    const creds = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64");
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: process.env.QBO_REDIRECT_URI }),
    });
    if (!r.ok) throw new Error(`Token exchange failed: ${await r.text()}`);
    const tokens = await r.json();
    return { ...tokens, created_at: Date.now() };
  },

  async refreshTokens(refreshToken) {
    const creds = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64");
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    });
    if (!r.ok) throw new Error("Token refresh failed");
    const tokens = await r.json();
    return { ...tokens, created_at: Date.now() };
  },

  async getValidToken(stored) {
    if (!stored?.qboTokens) throw new Error("Not authenticated");
    const { created_at, expires_in, refresh_token } = stored.qboTokens;
    if (Date.now() > created_at + expires_in * 1000 - 60000) {
      const newTokens = await this.refreshTokens(refresh_token);
      stored.qboTokens = newTokens;
      return newTokens.access_token;
    }
    return stored.qboTokens.access_token;
  },

  async apiCall(stored, method, path, body = null) {
    const token = await this.getValidToken(stored);
    const url = `${getBase()}/v3/company/${stored.realmId}${path}`;
    const opts = { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`QBO API error ${r.status}: ${await r.text()}`);
    return r.json();
  },

  async getInvoice(stored, invoiceId) { return this.apiCall(stored, "GET", `/invoice/${invoiceId}`); },
  async queryInvoices(stored, where = "") {
    return this.apiCall(stored, "GET", `/query?query=${encodeURIComponent(`SELECT * FROM Invoice ${where} MAXRESULTS 100`)}`);
  },
  async getItems(stored) {
    return this.apiCall(stored, "GET", `/query?query=${encodeURIComponent("SELECT * FROM Item MAXRESULTS 200")}`);
  },
};
