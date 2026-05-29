import { Router } from "express";
import { qboService } from "../services/qbo.js";

export const authRouter = Router();

const JSONBIN_API = "https://api.jsonbin.io/v3";

async function getBin() {
  const r = await fetch(`${JSONBIN_API}/b/${process.env.JSONBIN_BIN_ID}/latest`, {
    headers: { "X-Master-Key": process.env.JSONBIN_API_KEY, "X-Bin-Meta": "false" }
  });
  if (!r.ok) throw new Error(`JSONBin read failed: ${r.status}`);
  return r.json();
}

async function putBin(data) {
  const r = await fetch(`${JSONBIN_API}/b/${process.env.JSONBIN_BIN_ID}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Master-Key": process.env.JSONBIN_API_KEY },
    body: JSON.stringify(data)
  });
  if (!r.ok) throw new Error(`JSONBin write failed: ${r.status}`);
  return r.json();
}

async function saveTokens(tokens, realmId) {
  const current = await getBin();
  await putBin({ ...current, qboTokens: tokens, realmId });
}

export async function loadTokens() {
  try {
    const data = await getBin();
    if (!data?.qboTokens) return null;
    const { created_at, expires_in, refresh_token } = data.qboTokens;
    const isExpired = Date.now() > created_at + (expires_in * 1000) - 120000;
    if (isExpired) {
      console.log("[Auth] Token expired — refreshing...");
      try {
        const newTokens = await qboService.refreshTokens(refresh_token);
        await saveTokens(newTokens, data.realmId);
        console.log("[Auth] Token refreshed ✓");
        return { qboTokens: newTokens, realmId: data.realmId };
      } catch (err) {
        console.error("[Auth] Refresh failed:", err.message);
        return { qboTokens: data.qboTokens, realmId: data.realmId };
      }
    }
    return { qboTokens: data.qboTokens, realmId: data.realmId };
  } catch { return null; }
}

authRouter.get("/connect", (req, res) => {
  const clientId = process.env.QBO_CLIENT_ID;
  const redirectUri = process.env.QBO_REDIRECT_URI;
  if (!clientId || !redirectUri) return res.status(500).json({ error: "Missing env vars" });
  const params = new URLSearchParams({
    client_id: clientId, response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: redirectUri, state: Math.random().toString(36).substring(7),
  });
  res.redirect(`https://appcenter.intuit.com/connect/oauth2?${params}`);
});

authRouter.get("/callback", async (req, res) => {
  const { code, realmId, error } = req.query;
  if (error) return res.status(400).json({ error });
  if (!code || !realmId) return res.status(400).json({ error: "Missing code or realmId" });
  try {
    const tokens = await qboService.exchangeCodeForTokens(code, realmId);
    await saveTokens(tokens, realmId);
    res.json({ success: true, message: "QuickBooks connected successfully! ✓", realmId,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

authRouter.get("/status", async (req, res) => {
  const stored = await loadTokens();
  if (!stored?.qboTokens) return res.json({ connected: false });
  const expiresAt = new Date(stored.qboTokens.created_at + stored.qboTokens.expires_in * 1000);
  res.json({ connected: true, realmId: stored.realmId, expiresAt: expiresAt.toISOString(), expired: expiresAt < new Date() });
});

authRouter.get("/disconnect", async (req, res) => {
  try {
    const current = await getBin();
    delete current.qboTokens; delete current.realmId;
    await putBin(current);
  } catch {}
  res.json({ success: true });
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
