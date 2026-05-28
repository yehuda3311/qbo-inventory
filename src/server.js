import express from "express";
import session from "express-session";
import { authRouter } from "./routes/auth.js";
import { webhookRouter } from "./routes/webhook.js";
import { inventoryRouter } from "./routes/inventory.js";
import { productsRouter } from "./routes/products.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-me-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === "production" },
  })
);

// Routes
app.use("/auth", authRouter);
app.use("/webhook", webhookRouter);
app.use("/inventory", inventoryRouter);
app.use("/products", productsRouter);

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    connected: !!req.session?.qboTokens,
    message: req.session?.qboTokens
      ? "QuickBooks connected ✓"
      : "Visit /auth/connect to link QuickBooks",
  });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
