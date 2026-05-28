import { Router } from "express";
import { qboService } from "../services/qbo.js";

export const authRouter = Router();

const JSONBIN_API = "https://api.jsonbin.io/v3";

async function saveTokens(tokens, realmId) {
  const binId = process.env.JSONBIN_BIN_ID;
  const apiKey = process.env.JSONBIN_API_KEY;
  
  // Read current bin data first
  const r = await fetch(`${JSONBIN_API}/b/${binId}/latest`, {
    headers: { "X-Master-Key": apiKey, "X-Bin-Meta": "false" }
  });
  const current = await r.json();
  
  // Merge tokens into existing data
  const updated = { ...current, qboTokens: tokens, realmId };
  
  await fetch(`${JSONBIN_API}/b/${binId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Master-Key": apiKey },
    body: JSON.stringify(updated)
  });
}

export async function loadTokens() {
  const binId = process.env.JSONBIN_BIN_ID;
  const apiKey = process.env.JSONBIN_API_KEY;
  try {
    const r = await fetch(`${JSONBIN_API}/b/${binId}/latest`, {
      headers: { "X-Master-Key": apiKey, "X-Bin-Meta": "false" }
    });
    const data = await r.json();
    if (!data?.qboTokens) return null;
    return { qboTokens: data.qboTokens, realmId: data.realmId };
  } catch { return null; }
}

authRouter.get("/connect", (req, res) => {
  const clientId = process.env.QBO_CLIENT_ID;
  const redirectUri = process.env.QBO_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).json({
      error: "Missing env vars",
      clientId: clientId ? "set" : "MISSING",
      redirectUri: redirectUri ? "set" : "MISSING"
    });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: redirectUri,
    state: Math.random().toString(36).substring(7),
  });

  res.redirect(`https://appcenter.intuit.com/connect/oauth2?${params}`);
});

authRouter.get("/callback", async (req, res) => {
  const { code, realmId, error } = req.query;

  if (error) return res.status(400).json({ error: `QuickBooks auth error: ${error}` });
  if (!code || !realmId) return res.status(400).json({ error: "Missing code or realmId" });

  try {
    const tokens = await qboService.exchangeCodeForTokens(code, realmId);
    await saveTokens(tokens, realmId);

    res.json({
      success: true,
      message: "QuickBooks connected successfully! ✓",
      realmId,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    });
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.status(500).json({ error: "Failed to exchange code for tokens", details: err.message });
  }
});

authRouter.get("/status", async (req, res) => {
  const stored = await loadTokens();
  if (!stored?.qboTokens) {
    return res.json({ connected: false, message: "Not connected. Visit /auth/connect" });
  }
  const { created_at, expires_in } = stored.qboTokens;
  const expiresAt = new Date(created_at + expires_in * 1000);
  res.json({
    connected: true,
    realmId: stored.realmId,
    expiresAt: expiresAt.toISOString(),
    expired: expiresAt < new Date(),
  });
});

authRouter.get("/disconnect", async (req, res) => {
  try {
    const binId = process.env.JSONBIN_BIN_ID;
    const apiKey = process.env.JSONBIN_API_KEY;
    const r = await fetch(`${JSONBIN_API}/b/${binId}/latest`, {
      headers: { "X-Master-Key": apiKey, "X-Bin-Meta": "false" }
    });
    const current = await r.json();
    delete current.qboTokens;
    delete current.realmId;
    await fetch(`${JSONBIN_API}/b/${binId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Master-Key": apiKey },
      body: JSON.stringify(current)
    });
  } catch {}
  res.json({ success: true, message: "Disconnected from QuickBooks" });
});

authRouter.get("/debug", (req, res) => {
  res.json({
    QBO_CLIENT_ID: process.env.QBO_CLIENT_ID ? "SET ✓" : "MISSING ✗",
    QBO_CLIENT_SECRET: process.env.QBO_CLIENT_SECRET ? "SET ✓" : "MISSING ✗",
    QBO_REDIRECT_URI: process.env.QBO_REDIRECT_URI || "MISSING ✗",
    QBO_ENVIRONMENT: process.env.QBO_ENVIRONMENT || "MISSING ✗",
    JSONBIN_BIN_ID: process.env.JSONBIN_BIN_ID ? "SET ✓" : "MISSING ✗",
    JSONBIN_API_KEY: process.env.JSONBIN_API_KEY ? "SET ✓" : "MISSING ✗",
  });
});
