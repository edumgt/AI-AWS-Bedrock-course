/**
 * Simple in-memory ring buffer for token usage.
 * - course/demo friendly (no DB)
 * - stores last N entries
 *
 * Each entry:
 * {
 *   ts: ISO string,
 *   kind: "converse" | "agent" | "rag" | "other",
 *   modelId?: string,
 *   agentId?: string,
 *   inputTokens?: number,
 *   outputTokens?: number,
 *   totalTokens?: number,
 *   estimated?: boolean,   // true when not from Bedrock usage (best-effort)
 *   meta?: object
 * }
 */
const MAX = Number(process.env.USAGE_MAX || 500);

const buf = [];

function clampInt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return undefined;
  return Math.max(0, Math.floor(x));
}

function add(entry) {
  const safe = {
    ts: new Date().toISOString(),
    kind: entry.kind || "other",
    modelId: entry.modelId,
    agentId: entry.agentId,
    inputTokens: clampInt(entry.inputTokens),
    outputTokens: clampInt(entry.outputTokens),
    totalTokens: clampInt(entry.totalTokens),
    estimated: !!entry.estimated,
    meta: entry.meta || undefined,
  };
  buf.push(safe);
  while (buf.length > MAX) buf.shift();
  return safe;
}

function list(limit = 50) {
  const n = Math.max(1, Math.min(500, Number(limit) || 50));
  return buf.slice(-n).reverse(); // newest first
}

function summary(limit = 100) {
  const rows = list(limit).slice().reverse(); // oldest->newest for averaging
  let count = 0;
  let inSum = 0;
  let outSum = 0;
  let totalSum = 0;

  for (const e of rows) {
    if (typeof e.inputTokens === "number" || typeof e.outputTokens === "number" || typeof e.totalTokens === "number") {
      count += 1;
      inSum += e.inputTokens || 0;
      outSum += e.outputTokens || 0;
      totalSum += e.totalTokens || ((e.inputTokens || 0) + (e.outputTokens || 0));
    }
  }

  const last = rows.length ? rows[rows.length - 1].ts : null;

  return {
    window: Math.min(rows.length, Math.max(1, Number(limit) || 100)),
    count,
    avgInputTokens: count ? inSum / count : 0,
    avgOutputTokens: count ? outSum / count : 0,
    avgTotalTokens: count ? totalSum / count : 0,
    lastTs: last,
  };
}

module.exports = { add, list, summary };
