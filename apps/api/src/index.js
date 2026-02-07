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
app.listen(port, () => console.log(`[api] listening on http://localhost:${port}`));
