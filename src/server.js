import express from "express";
import session from "express-session";
import { authRouter } from "./routes/auth.js";
import { webhookRouter } from "./routes/webhook.js";
import { inventoryRouter } from "./routes/inventory.js";
import { productsRouter } from "./routes/products.js";

const app = express();
const PORT = process.env.PORT || 3000;

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Parse JSON for all routes EXCEPT /webhook/qbo (needs raw body)
app.use((req, res, next) => {
  if (req.path === "/webhook/qbo") return next();
  express.json()(req, res, next);
});
app.use((req, res, next) => {
  if (req.path === "/webhook/qbo") return next();
  express.urlencoded({ extended: true })(req, res, next);
});

app.use(session({
  secret: process.env.SESSION_SECRET || "change-me-in-production",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === "production" },
}));

app.use("/auth", authRouter);
app.use("/webhook", webhookRouter);
app.use("/inventory", inventoryRouter);
app.use("/products", productsRouter);

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Kratomyx & Kavana QBO Sync Server" });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
