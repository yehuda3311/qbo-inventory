# Kratomyx & Kavana — QuickBooks Inventory Sync

## What this does
When an invoice is marked **paid** in QuickBooks Online, the Railway backend receives a webhook, fetches the invoice line items, and deducts the sold quantities from your JSONBin finished products inventory — automatically.

---

## Step 1 — Deploy to Railway

1. Create a new GitHub repo and push this entire `qbo-inventory/` folder to it.
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
3. Select your repo. Railway auto-detects Node.js via `nixpacks.toml`.
4. Under **Settings → Variables**, add all values from `.env.example`:

```
QBO_CLIENT_ID         = (from Intuit Developer Portal)
QBO_CLIENT_SECRET     = (from Intuit Developer Portal)
QBO_REDIRECT_URI      = https://YOUR-APP.up.railway.app/auth/callback
QBO_ENVIRONMENT       = production
QBO_WEBHOOK_VERIFIER_TOKEN = (from Intuit Developer Portal → Webhooks)
JSONBIN_BIN_ID        = 6a16384b8ef04f45381f726b
JSONBIN_API_KEY       = (your JSONBin master key)
SESSION_SECRET        = (any long random string)
NODE_ENV              = production
```

5. Copy your Railway app URL (e.g. `https://qbo-inventory-production.up.railway.app`).

---

## Step 2 — QuickBooks Developer Setup

1. Go to [developer.intuit.com](https://developer.intuit.com) → your app.
2. Under **Keys & OAuth** → set **Redirect URI** to:
   ```
   https://YOUR-APP.up.railway.app/auth/callback
   ```
3. Under **Webhooks** → add endpoint URL:
   ```
   https://YOUR-APP.up.railway.app/webhook/qbo
   ```
   Subscribe to: **Invoice → Update** events only.
4. Copy the **Verifier Token** into `QBO_WEBHOOK_VERIFIER_TOKEN`.

---

## Step 3 — Connect via the Frontend

1. Open `frontend/inventory.html` in your browser (or host it anywhere).
2. Click the **QuickBooks** tab.
3. Enter your Railway URL and click **Save**.
4. Click **Connect QBO** → authorize in the popup.
5. Click **Check status** to confirm connection.

---

## Step 4 — Import Products from QuickBooks (one-time)

1. In the **QuickBooks** tab → **Import products from QBO**.
2. Select brand (Kratom or Kava).
3. Click **Fetch from QBO** → review the list.
4. For each product, select its **category** (Bulk Bags, Stickpacks, Gallons, Shots).
5. Check the ones to import → click **Import selected**.

This links each QBO inventory item to a product in your JSONBin inventory by `qboItemId`. The webhook uses this link to deduct the right product when an invoice is paid.

---

## How the Webhook Flow Works

```
Customer pays invoice in QBO
        ↓
QBO sends POST to /webhook/qbo
        ↓
Server verifies HMAC signature
        ↓
Fetches full invoice from QBO API
        ↓
Checks: Balance === 0 (fully paid)?
        ↓ yes
Extracts line items (ItemRef + Qty)
        ↓
Reads JSONBin inventory
        ↓
Matches items by qboItemId
        ↓
Deducts quantities, writes back to JSONBin
        ↓
Frontend auto-refreshes every 60s
```

---

## API Endpoints Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Health check + connection status |
| GET | `/auth/connect` | Start QBO OAuth flow |
| GET | `/auth/callback` | OAuth callback (set as Redirect URI) |
| GET | `/auth/status` | Check QBO connection status |
| GET | `/auth/disconnect` | Clear QBO tokens |
| POST | `/webhook/qbo` | QBO webhook receiver |
| POST | `/webhook/manual-sync/:id` | Manually sync one invoice |
| POST | `/webhook/sync-paid-since` | Bulk sync paid invoices |
| GET | `/products/qbo` | Fetch QBO inventory items |
| POST | `/products/import` | Import selected items to JSONBin |
| GET | `/inventory` | Read current JSONBin inventory |
| PUT | `/inventory` | Write full inventory to JSONBin |
| POST | `/inventory/deduct` | Manual deduction (testing) |
