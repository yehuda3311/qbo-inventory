// All config comes from environment variables — set these in Railway dashboard
export function getConfig() {
  return {
    qbo: {
      clientId: process.env.QBO_CLIENT_ID,
      clientSecret: process.env.QBO_CLIENT_SECRET,
      redirectUri: process.env.QBO_REDIRECT_URI,
      environment: process.env.QBO_ENVIRONMENT || "production",
      scopes: "com.intuit.quickbooks.accounting",
    },
    jsonbin: {
      binId: process.env.JSONBIN_BIN_ID,
      apiKey: process.env.JSONBIN_API_KEY,
      baseUrl: "https://api.jsonbin.io/v3",
    },
    webhookVerifierToken: process.env.QBO_WEBHOOK_VERIFIER_TOKEN,
  };
}

// Keep backward compat
export const config = new Proxy({}, {
  get(_, prop) {
    return getConfig()[prop];
  }
});
