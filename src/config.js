export function getConfig() {
  return {
    qbo: {
      clientId: process.env.QBO_CLIENT_ID,
      clientSecret: process.env.QBO_CLIENT_SECRET,
      redirectUri: process.env.QBO_REDIRECT_URI,
      environment: process.env.QBO_ENVIRONMENT || "production",
    },
    jsonbin: {
      binId: process.env.JSONBIN_BIN_ID,
      apiKey: process.env.JSONBIN_API_KEY,
    },
    webhookVerifierToken: process.env.QBO_WEBHOOK_VERIFIER_TOKEN,
  };
}
