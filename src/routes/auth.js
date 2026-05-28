import { Router } from "express";
import { qboService } from "../services/qbo.js";
import { writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";

export const authRouter = Router();

const TOKEN_FILE = "/tmp/qbo_tokens.json";

async function saveTokens(tokens, realmId) {
  await writeFile(TOKEN_FILE, JSON.stringify({ qboTokens: tokens, realmId }));
}

async function loadTokens() {
  try {
    if (!existsSync(TOKEN_FILE)) return null;
    const raw = await readFile(TOKEN_FILE, "utf8");
    return JSON.parse(raw);
  } catch { return null; }
}

authRouter.get("/connect", (req, res) => {
  const clientId = process.env.QBO_CLIENT_ID;
  const redirectUri = process.env.QBO_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).json({
      error: "Missing QBO_CLIENT_ID or QBO_REDIRECT_URI",
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
  try { await writeFile(TOKEN_FILE, JSON.stringify({})); } catch {}
  res.json({ success: true, message: "Disconnected from QuickBooks" });
});

authRouter.get("/debug", (req, res) => {
  res.json({
    QBO_CLIENT_ID: process.env.QBO_CLIENT_ID ? "SET ✓" : "MISSING ✗",
    QBO_CLIENT_SECRET: process.env.QBO_CLIENT_SECRET ? "SET ✓" : "MISSING ✗",
    QBO_REDIRECT_URI: process.env.QBO_REDIRECT_URI || "MISSING ✗",
    QBO_ENVIRONMENT: process.env.QBO_ENVIRONMENT || "MISSING ✗",
  });
});

export { loadTokens };
