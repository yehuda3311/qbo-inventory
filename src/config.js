// All config comes from environment variables — set these in Railway dashboard
export const config = {
  // QuickBooks OAuth
  qbo: {
    clientId: process.env.QBO_CLIENT_ID,
    clientSecret: process.env.QBO_CLIENT_SECRET,
    redirectUri: process.env.QBO_REDIRECT_URI, // e.g. https://your-app.railway.app/auth/callback
    environment: process.env.QBO_ENVIRONMENT || "sandbox", // "sandbox" or "production"
    scopes: "com.intuit.quickbooks.accounting",
  },

  // JSONBin
  jsonbin: {
    binId: process.env.JSONBIN_BIN_ID,
    apiKey: process.env.JSONBIN_API_KEY,
    baseUrl: "https://api.jsonbin.io/v3",
  },

  // Webhook security
  webhookVerifierToken: process.env.QBO_WEBHOOK_VERIFIER_TOKEN,
};

// Validate required vars at startup
const required = [
  "QBO_CLIENT_ID",
  "QBO_CLIENT_SECRET",
  "QBO_REDIRECT_URI",
  "JSONBIN_BIN_ID",
  "JSONBIN_API_KEY",
];

for (const key of required) {
  if (!process.env[key]) {
    console.warn(`⚠️  Missing env var: ${key}`);
  }
}
