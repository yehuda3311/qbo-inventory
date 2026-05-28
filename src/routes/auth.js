import { Router } from "express";
import { config } from "../config.js";
import { qboService } from "../services/qbo.js";

export const authRouter = Router();

// Step 1: Redirect user to QuickBooks authorization page
authRouter.get("/connect", (req, res) => {
  const params = new URLSearchParams({
    client_id: config.qbo.clientId,
    response_type: "code",
    scope: config.qbo.scopes,
    redirect_uri: config.qbo.redirectUri,
    state: Math.random().toString(36).substring(7), // CSRF token (use redis/session in prod)
  });

  const baseUrl =
    config.qbo.environment === "production"
      ? "https://appcenter.intuit.com/connect/oauth2"
      : "https://appcenter.intuit.com/connect/oauth2";

  res.redirect(`${baseUrl}?${params}`);
});

// Step 2: QuickBooks redirects back here with auth code
authRouter.get("/callback", async (req, res) => {
  const { code, realmId, error } = req.query;

  if (error) {
    return res.status(400).json({ error: `QuickBooks auth error: ${error}` });
  }

  if (!code || !realmId) {
    return res.status(400).json({ error: "Missing code or realmId" });
  }

  try {
    const tokens = await qboService.exchangeCodeForTokens(code, realmId);

    // Store tokens in session (use a DB in production for multi-tenant)
    req.session.qboTokens = tokens;
    req.session.realmId = realmId;

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

// Check connection status
authRouter.get("/status", (req, res) => {
  if (!req.session?.qboTokens) {
    return res.json({ connected: false, message: "Not connected. Visit /auth/connect" });
  }
  const expiresAt = new Date(req.session.qboTokens.created_at + req.session.qboTokens.expires_in * 1000);
  res.json({
    connected: true,
    realmId: req.session.realmId,
    expiresAt: expiresAt.toISOString(),
    expired: expiresAt < new Date(),
  });
});

// Disconnect / clear tokens
authRouter.get("/disconnect", (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: "Disconnected from QuickBooks" });
});
