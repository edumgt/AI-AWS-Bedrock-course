require("dotenv").config();

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const { createClients } = require("./bedrockClients");
const { createRouter } = require("./routes");

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

const origins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: origins.length ? origins : true,
    credentials: true,
  })
);

const clients = createClients();
app.use("/api", createRouter(clients));

app.use((err, req, res, next) => {
  console.error("[ERROR]", err);
  res.status(500).json({
    error: err.name || "Error",
    message: err.message || "Unknown error",
  });
});

const port = Number(process.env.PORT || 8080);

// ------------------------------
// JSON error handler (for API)
// Ensures frontend always receives JSON instead of HTML error pages.
// ------------------------------
app.use("/api", (req, res, next) => {
  // 404 for unknown /api routes
  res.status(404).json({ error: "NotFound", message: `No route: ${req.method} ${req.originalUrl}` });
});

// JSON error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[API ERROR]", err);

  // AWS SDK v3 errors often contain name / message / $metadata.httpStatusCode
  const status = err?.$metadata?.httpStatusCode || err?.statusCode || err?.status || 500;

  res.status(status).json({
    error: err?.name || "InternalServerError",
    message: err?.message || String(err),
    status,
    requestId: err?.$metadata?.requestId,
    // In dev, it's useful to see a stack
    stack: process.env.NODE_ENV === "production" ? undefined : err?.stack,
  });
});

app.listen(port, () => console.log(`[api] listening on http://localhost:${port}`));
