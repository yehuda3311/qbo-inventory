const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

function getBase() {
  return process.env.QBO_ENVIRONMENT === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

export const qboService = {
  async exchangeCodeForTokens(code, realmId) {
    const credentials = Buffer.from(
      `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`
    ).toString("base64");

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.QBO_REDIRECT_URI,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Token exchange failed: ${err}`);
    }

    const tokens = await res.json();
    return { ...tokens, created_at: Date.now() };
  },

  async refreshTokens(refreshToken) {
    const credentials = Buffer.from(
      `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`
    ).toString("base64");

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!res.ok) throw new Error("Token refresh failed");
    const tokens = await res.json();
    return { ...tokens, created_at: Date.now() };
  },

  // Works with stored token object { qboTokens, realmId }
  async getValidToken(stored) {
    if (!stored?.qboTokens) throw new Error("Not authenticated with QuickBooks");

    const { created_at, expires_in, refresh_token } = stored.qboTokens;
    const isExpired = Date.now() > created_at + expires_in * 1000 - 60000;

    if (isExpired) {
      console.log("Access token expired, refreshing...");
      const newTokens = await this.refreshTokens(refresh_token);
      stored.qboTokens = newTokens;
      return newTokens.access_token;
    }

    return stored.qboTokens.access_token;
  },

  async apiCall(stored, method, path, body = null) {
    const token = await this.getValidToken(stored);
    const realmId = stored.realmId;
    const url = `${getBase()}/v3/company/${realmId}${path}`;

    const opts = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`QBO API error ${res.status}: ${err}`);
    }
    return res.json();
  },

  async getInvoice(stored, invoiceId) {
    return this.apiCall(stored, "GET", `/invoice/${invoiceId}`);
  },

  async queryInvoices(stored, whereClause = "") {
    const query = encodeURIComponent(`SELECT * FROM Invoice ${whereClause} MAXRESULTS 100`);
    return this.apiCall(stored, "GET", `/query?query=${query}`);
  },

  async getItems(stored) {
    const query = encodeURIComponent("SELECT * FROM Item MAXRESULTS 200");
    return this.apiCall(stored, "GET", `/query?query=${query}`);
  },
};
