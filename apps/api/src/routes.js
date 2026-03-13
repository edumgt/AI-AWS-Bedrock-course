const express = require("express");
const {
  ListFoundationModelsCommand,
  ListInferenceProfilesCommand,
} = require("@aws-sdk/client-bedrock");
const {
  ConverseCommand,
  ConverseStreamCommand,
  InvokeModelCommand,
} = require("@aws-sdk/client-bedrock-runtime");
const {
  RetrieveAndGenerateCommand,
  InvokeAgentCommand,
} = require("@aws-sdk/client-bedrock-agent-runtime");

const { ChatSchema, RagSchema, AgentInvokeSchema, EmbedSchema } = require("./validators");
const usageStore = require("./usageStore");
const tenantStore = require("./tenantStore");

function toBedrockMessages(messages) {
  return messages.map((m) => ({ role: m.role, content: [{ text: m.content }] }));
}

function bytesToUtf8(bytes) {
  try {
    return new TextDecoder("utf-8").decode(bytes);
  } catch (_) {
    return "";
  }
}

function estimateTokensByChars(text, mode = "ko") {
  const chars = (text || "").length;
  const div = mode === "en" ? 4 : 2;
  return Math.max(1, Math.ceil(chars / div));
}

function pickUsageFromAgentTrace(traceObj) {
  try {
    const candidates = [];
    const walk = (obj) => {
      if (!obj || typeof obj !== "object") return;
      if (obj.usage || obj.tokenUsage || obj.tokens) candidates.push(obj);
      for (const k of Object.keys(obj)) walk(obj[k]);
    };
    walk(traceObj);

    for (const c of candidates) {
      const u = c.usage || c.tokenUsage || c.tokens || null;
      if (!u || typeof u !== "object") continue;
      const inputTokens = u.inputTokens ?? u.input ?? u.promptTokens ?? u.prompt ?? u.input_token_count;
      const outputTokens = u.outputTokens ?? u.output ?? u.completionTokens ?? u.completion ?? u.output_token_count;
      const totalTokens = u.totalTokens ?? u.total ?? u.total_token_count;
      if (inputTokens != null || outputTokens != null || totalTokens != null) {
        return { inputTokens, outputTokens, totalTokens };
      }
    }
  } catch (_) {}
  return null;
}

const rpmWindow = new Map();

function enforceRateLimit(req, res, next) {
  const { tenantId, plan } = req.tenant;
  const minute = Math.floor(Date.now() / 60000);
  const key = `${tenantId}:${minute}`;
  const current = rpmWindow.get(key) || 0;

  if (current >= plan.rpm) {
    return res.status(429).json({
      error: "RateLimitExceeded",
      message: `RPM quota exceeded for tenant ${tenantId}`,
      tenantId,
      plan: plan.key,
      rpmLimit: plan.rpm,
    });
  }

  rpmWindow.set(key, current + 1);
  return next();
}

function enforceTokenQuota(req, res, next) {
  const { tenantId, plan } = req.tenant;
  const used = tenantStore.getUsage(tenantId);
  if (used >= plan.monthlyTokenLimit) {
    return res.status(402).json({
      error: "TokenQuotaExceeded",
      message: `Monthly token quota exceeded for tenant ${tenantId}`,
      tenantId,
      plan: plan.key,
      used,
      limit: plan.monthlyTokenLimit,
    });
  }
  return next();
}

function trackTokens(req, tokens) {
  const total = Math.max(0, Number(tokens) || 0);
  if (total > 0) tenantStore.addUsage(req.tenant.tenantId, total);
}

function createRouter(clients) {
  const router = express.Router();

  router.use((req, res, next) => {
    const tenant = tenantStore.resolveTenant(req);
    const plan = tenantStore.getPlan(tenant.plan);
    req.tenant = { ...tenant, plan };
    next();
  });

  router.get("/health", (req, res) => res.json({ ok: true }));

  router.get("/saas/plans", (req, res) => {
    res.json({ plans: tenantStore.listPlans() });
  });

  router.get("/saas/tenant", (req, res) => {
    const usedTokens = tenantStore.getUsage(req.tenant.tenantId);
    res.json({
      tenantId: req.tenant.tenantId,
      plan: req.tenant.plan,
      usage: {
        month: new Date().toISOString().slice(0, 7),
        usedTokens,
        limitTokens: req.tenant.plan.monthlyTokenLimit,
        remainingTokens: Math.max(0, req.tenant.plan.monthlyTokenLimit - usedTokens),
      },
    });
  });

  router.get("/saas/tenants", (req, res) => {
    const tenants = tenantStore.listTenants().map((t) => {
      const plan = tenantStore.getPlan(t.plan);
      const usedTokens = tenantStore.getUsage(t.tenantId);
      return {
        tenantId: t.tenantId,
        plan,
        usedTokens,
      };
    });
    res.json({ count: tenants.length, tenants });
  });

  router.get("/usage/recent", (req, res) => {
    const limit = Number(req.query.limit || 50);
    res.json({ items: usageStore.list(limit, { tenantId: req.tenant.tenantId }) });
  });

  router.get("/usage/summary", (req, res) => {
    const limit = Number(req.query.limit || 100);
    res.json(usageStore.summary(limit, { tenantId: req.tenant.tenantId }));
  });

  router.get("/models", async (req, res, next) => {
    try {
      const out = await clients.bedrock.send(new ListFoundationModelsCommand({}));
      const models = (out.modelSummaries || []).map((m) => ({
        modelId: m.modelId,
        modelName: m.modelName,
        providerName: m.providerName,
        inputModalities: m.inputModalities,
        outputModalities: m.outputModalities,
        responseStreamingSupported: m.responseStreamingSupported,
      }));
      res.json({ count: models.length, models });
    } catch (e) {
      next(e);
    }
  });

  router.get("/inference-profiles", async (req, res, next) => {
    try {
      if (typeof ListInferenceProfilesCommand !== "function") {
        return res.status(501).json({
          error: "NotSupported",
          message: "ListInferenceProfilesCommand is not available in this AWS SDK version. Update @aws-sdk/client-bedrock.",
        });
      }
      const out = await clients.bedrock.send(new ListInferenceProfilesCommand({}));
      const summaries = out.inferenceProfileSummaries || out.inferenceProfiles || out.profiles || [];
      const profiles = summaries.map((p) => ({
        inferenceProfileId: p.inferenceProfileId || p.id,
        inferenceProfileArn: p.inferenceProfileArn || p.arn,
        inferenceProfileName: p.inferenceProfileName || p.name,
        modelSource: p.modelSource || p.modelArn || p.modelId,
        createdAt: p.createdAt,
        status: p.status,
      }));
      res.json({ count: profiles.length, profiles });
    } catch (e) {
      next(e);
    }
  });

  router.post("/chat", enforceRateLimit, enforceTokenQuota, async (req, res, next) => {
    try {
      const data = ChatSchema.parse(req.body);
      const out = await clients.runtime.send(
        new ConverseCommand({
          modelId: data.modelId,
          system: data.system ? [{ text: data.system }] : undefined,
          messages: toBedrockMessages(data.messages),
          inferenceConfig: {
            temperature: data.temperature,
            topP: data.topP,
            maxTokens: data.maxTokens,
          },
        })
      );

      const text =
        out?.output?.message?.content
          ?.map((c) => c.text)
          .filter(Boolean)
          .join("") || "";

      if (out?.usage) {
        usageStore.add({
          tenantId: req.tenant.tenantId,
          kind: "converse",
          modelId: data.modelId,
          inputTokens: out.usage.inputTokens,
          outputTokens: out.usage.outputTokens,
          totalTokens: out.usage.totalTokens,
          estimated: false,
        });
        trackTokens(req, out.usage.totalTokens || ((out.usage.inputTokens || 0) + (out.usage.outputTokens || 0)));
      }

      res.json({ text, stopReason: out?.stopReason, usage: out?.usage, tenantId: req.tenant.tenantId });
    } catch (e) {
      next(e);
    }
  });

  router.post("/chat/stream", enforceRateLimit, enforceTokenQuota, async (req, res) => {
    try {
      const data = ChatSchema.parse(req.body);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const out = await clients.runtime.send(
        new ConverseStreamCommand({
          modelId: data.modelId,
          system: data.system ? [{ text: data.system }] : undefined,
          messages: toBedrockMessages(data.messages),
          inferenceConfig: {
            temperature: data.temperature,
            topP: data.topP,
            maxTokens: data.maxTokens,
          },
        })
      );

      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      send({ type: "start" });

      let lastUsage = null;
      for await (const ev of out.stream) {
        const deltaText = ev?.contentBlockDelta?.delta?.text || ev?.delta?.text || null;
        if (deltaText) {
          send({ type: "delta", text: deltaText });
          continue;
        }

        const usage = ev?.metadata?.usage || ev?.usage || null;
        if (usage) {
          lastUsage = usage;
          send({ type: "usage", usage });
        }

        const stopReason = ev?.messageStop?.stopReason || ev?.stopReason || null;
        if (stopReason) send({ type: "stop", stopReason });
      }

      if (lastUsage) {
        usageStore.add({
          tenantId: req.tenant.tenantId,
          kind: "converse",
          modelId: data.modelId,
          inputTokens: lastUsage.inputTokens,
          outputTokens: lastUsage.outputTokens,
          totalTokens: lastUsage.totalTokens,
          estimated: false,
        });
        trackTokens(req, lastUsage.totalTokens || ((lastUsage.inputTokens || 0) + (lastUsage.outputTokens || 0)));
      }

      send({ type: "done" });
      res.end();
    } catch (e) {
      res.write(`data: ${JSON.stringify({ type: "error", message: e.message })}\n\n`);
      res.end();
    }
  });

  router.post("/embed", enforceRateLimit, enforceTokenQuota, async (req, res, next) => {
    try {
      const data = EmbedSchema.parse(req.body);
      const mid = data.modelId;
      let body;

      if (mid.includes("titan-embed")) body = { inputText: data.text };
      else if (mid.includes("cohere.embed")) body = { texts: [data.text], input_type: data.inputType || "search_document" };
      else body = { inputText: data.text };

      const out = await clients.runtime.send(
        new InvokeModelCommand({
          modelId: mid,
          contentType: "application/json",
          accept: "application/json",
          body: Buffer.from(JSON.stringify(body)),
        })
      );

      const raw = bytesToUtf8(out.body);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { raw };
      }

      const embedding =
        parsed.embedding ||
        (Array.isArray(parsed.embeddings) ? parsed.embeddings[0] : undefined) ||
        (Array.isArray(parsed.vectors) ? parsed.vectors[0] : undefined);

      const inputTokens = parsed.inputTextTokenCount || parsed.prompt_tokens || parsed.promptTokens;
      usageStore.add({
        tenantId: req.tenant.tenantId,
        kind: "embed",
        modelId: mid,
        inputTokens: typeof inputTokens === "number" ? inputTokens : null,
        outputTokens: null,
        totalTokens: typeof inputTokens === "number" ? inputTokens : null,
        estimated: typeof inputTokens !== "number",
      });
      trackTokens(req, typeof inputTokens === "number" ? inputTokens : estimateTokensByChars(data.text));

      res.json({ modelId: mid, embedding, raw: parsed });
    } catch (e) {
      next(e);
    }
  });

  router.post("/rag", enforceRateLimit, enforceTokenQuota, async (req, res, next) => {
    try {
      if (!req.tenant.plan.allowRag) {
        return res.status(403).json({ error: "PlanRestriction", message: "RAG is not enabled in current plan." });
      }
      const data = RagSchema.parse(req.body);
      const out = await clients.agentRuntime.send(
        new RetrieveAndGenerateCommand({
          input: { text: data.query },
          retrieveAndGenerateConfiguration: {
            type: "KNOWLEDGE_BASE",
            knowledgeBaseConfiguration: {
              knowledgeBaseId: data.knowledgeBaseId,
              modelArn: data.modelArnOrId,
            },
          },
        })
      );

      const answer = out?.output?.text || "";
      const estimatedTotal = estimateTokensByChars(data.query) + estimateTokensByChars(answer);
      usageStore.add({
        tenantId: req.tenant.tenantId,
        kind: "rag",
        estimated: true,
        totalTokens: estimatedTotal,
        meta: { knowledgeBaseId: data.knowledgeBaseId },
      });
      trackTokens(req, estimatedTotal);

      const citations = out?.citations || [];
      res.json({ answer, citations, raw: req.query.raw === "1" ? out : undefined });
    } catch (e) {
      next(e);
    }
  });

  router.post("/agent/invoke", enforceRateLimit, enforceTokenQuota, async (req, res, next) => {
    try {
      if (!req.tenant.plan.allowAgents) {
        return res.status(403).json({ error: "PlanRestriction", message: "Agent invoke is not enabled in current plan." });
      }
      const data = AgentInvokeSchema.parse(req.body);
      const out = await clients.agentRuntime.send(
        new InvokeAgentCommand({
          agentId: data.agentId,
          agentAliasId: data.agentAliasId,
          sessionId: data.sessionId,
          inputText: data.inputText,
          enableTrace: data.enableTrace,
          endSession: data.endSession,
        })
      );

      let text = "";
      const trace = [];
      let usage = null;

      if (out?.completion) {
        for await (const ev of out.completion) {
          if (ev?.chunk?.bytes) text += bytesToUtf8(ev.chunk.bytes);
          if (ev?.trace) {
            trace.push(ev.trace);
            usage = usage || pickUsageFromAgentTrace(ev.trace);
          }
        }
      }

      const estimatedUsage = usage || {
        inputTokens: estimateTokensByChars(data.inputText),
        outputTokens: estimateTokensByChars(text),
        totalTokens: estimateTokensByChars(data.inputText) + estimateTokensByChars(text),
      };

      usageStore.add({
        tenantId: req.tenant.tenantId,
        kind: "agent",
        agentId: data.agentId,
        inputTokens: estimatedUsage.inputTokens,
        outputTokens: estimatedUsage.outputTokens,
        totalTokens: estimatedUsage.totalTokens,
        estimated: !usage,
      });
      trackTokens(req, estimatedUsage.totalTokens);

      res.json({
        sessionId: out?.sessionId,
        text,
        usage: estimatedUsage,
        trace: req.query.trace === "1" ? trace : undefined,
      });
    } catch (e) {
      next(e);
    }
  });

  router.post("/agent/stream", enforceRateLimit, enforceTokenQuota, async (req, res) => {
    try {
      if (!req.tenant.plan.allowAgents) {
        return res.status(403).json({ error: "PlanRestriction", message: "Agent stream is not enabled in current plan." });
      }
      const data = AgentInvokeSchema.parse(req.body);

      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const out = await clients.agentRuntime.send(
        new InvokeAgentCommand({
          agentId: data.agentId,
          agentAliasId: data.agentAliasId,
          sessionId: data.sessionId,
          inputText: data.inputText,
          enableTrace: data.enableTrace,
          endSession: data.endSession,
        })
      );

      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      send({ type: "start", sessionId: out?.sessionId });

      let generated = "";
      let traceUsage = null;

      if (out?.completion) {
        for await (const ev of out.completion) {
          if (ev?.chunk?.bytes) {
            const delta = bytesToUtf8(ev.chunk.bytes);
            if (delta) {
              generated += delta;
              send({ type: "delta", text: delta });
            }
          }
          if (ev?.trace) {
            traceUsage = traceUsage || pickUsageFromAgentTrace(ev.trace);
            send({ type: "trace", trace: ev.trace });
          }
        }
      }

      const used = traceUsage || {
        inputTokens: estimateTokensByChars(data.inputText),
        outputTokens: estimateTokensByChars(generated),
        totalTokens: estimateTokensByChars(data.inputText) + estimateTokensByChars(generated),
      };
      usageStore.add({
        tenantId: req.tenant.tenantId,
        kind: "agent",
        agentId: data.agentId,
        inputTokens: used.inputTokens,
        outputTokens: used.outputTokens,
        totalTokens: used.totalTokens,
        estimated: !traceUsage,
      });
      trackTokens(req, used.totalTokens);

      send({ type: "done" });
      res.end();
    } catch (e) {
      res.write(`data: ${JSON.stringify({ type: "error", message: e.message })}\n\n`);
      res.end();
    }
  });

  return router;
}

module.exports = { createRouter };
