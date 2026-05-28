import { config } from "../config.js";

const QBO_BASE =
  config.qbo?.environment === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

export const qboService = {
  // Exchange authorization code for access + refresh tokens
  async exchangeCodeForTokens(code, realmId) {
    const credentials = Buffer.from(
      `${config.qbo.clientId}:${config.qbo.clientSecret}`
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
        redirect_uri: config.qbo.redirectUri,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Token exchange failed: ${err}`);
    }

    const tokens = await res.json();
    return { ...tokens, created_at: Date.now() };
  },

  // Refresh expired access token using refresh token
  async refreshTokens(refreshToken) {
    const credentials = Buffer.from(
      `${config.qbo.clientId}:${config.qbo.clientSecret}`
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

  // Get a valid access token (auto-refresh if expired)
  async getValidToken(session) {
    if (!session?.qboTokens) throw new Error("Not authenticated with QuickBooks");

    const { created_at, expires_in, refresh_token } = session.qboTokens;
    const isExpired = Date.now() > created_at + expires_in * 1000 - 60000; // 1min buffer

    if (isExpired) {
      console.log("Access token expired, refreshing...");
      const newTokens = await this.refreshTokens(refresh_token);
      session.qboTokens = newTokens; // update session
      return newTokens.access_token;
    }

    return session.qboTokens.access_token;
  },

  // Generic QBO API call
  async apiCall(session, method, path, body = null) {
    const token = await this.getValidToken(session);
    const realmId = session.realmId;
    const url = `${QBO_BASE}/v3/company/${realmId}${path}`;

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

  // Fetch a single invoice by ID
  async getInvoice(session, invoiceId) {
    return this.apiCall(session, "GET", `/invoice/${invoiceId}`);
  },

  // Query invoices (e.g., all paid invoices)
  async queryInvoices(session, whereClause = "") {
    const query = encodeURIComponent(
      `SELECT * FROM Invoice ${whereClause} MAXRESULTS 100`
    );
    return this.apiCall(session, "GET", `/query?query=${query}`);
  },

  // Fetch all items (products) from QBO
  async getItems(session) {
    const query = encodeURIComponent(
      "SELECT * FROM Item WHERE Type='Inventory' MAXRESULTS 200"
    );
    return this.apiCall(session, "GET", `/query?query=${query}`);
  },
};
