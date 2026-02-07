const express = require("express");
const {
  ListFoundationModelsCommand,
} = require("@aws-sdk/client-bedrock");
const {
  ConverseCommand,
  ConverseStreamCommand,
} = require("@aws-sdk/client-bedrock-runtime");
const {
  RetrieveAndGenerateCommand,
  InvokeAgentCommand,
} = require("@aws-sdk/client-bedrock-agent-runtime");

const { ChatSchema, RagSchema, AgentInvokeSchema } = require("./validators");
const usageStore = require("./usageStore");

function toBedrockMessages(messages) {
  return messages.map((m) => ({
    role: m.role,
    content: [{ text: m.content }],
  }));
}

function bytesToUtf8(bytes) {
  try {
    // bytes: Uint8Array
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
  // Best-effort: Agent trace shapes vary. Try common paths.
  // Return {inputTokens, outputTokens, totalTokens} when found, else null.
  try {
    const t = traceObj;
    // Some traces might embed model invocation outputs with usage-like fields
    const candidates = [];

    const walk = (obj) => {
      if (!obj || typeof obj !== "object") return;
      // heuristic keys
      if (obj.usage || obj.tokenUsage || obj.tokens) candidates.push(obj);
      for (const k of Object.keys(obj)) walk(obj[k]);
    };
    walk(t);

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

function createRouter(clients) {
  const router = express.Router();

  router.get("/health", (req, res) => res.json({ ok: true }));

router.get("/usage/recent", (req, res) => {
  const limit = Number(req.query.limit || 50);
  res.json({ items: usageStore.list(limit) });
});

router.get("/usage/summary", (req, res) => {
  const limit = Number(req.query.limit || 100);
  res.json(usageStore.summary(limit));
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

  router.post("/chat", async (req, res, next) => {
    try {
      const data = ChatSchema.parse(req.body);

      const command = new ConverseCommand({
        modelId: data.modelId,
        system: data.system ? [{ text: data.system }] : undefined,
        messages: toBedrockMessages(data.messages),
        inferenceConfig: {
          temperature: data.temperature,
          topP: data.topP,
          maxTokens: data.maxTokens,
        },
      });

      const out = await clients.runtime.send(command);

      // Best-effort extraction of assistant text
      const text =
        out?.output?.message?.content
          ?.map((c) => c.text)
          .filter(Boolean)
          .join("") || "";

// Record token usage (when available)
// Converse usage shape commonly includes inputTokens / outputTokens / totalTokens
if (out?.usage) {
  usageStore.add({
    kind: "converse",
    modelId: data.modelId,
    inputTokens: out.usage.inputTokens,
    outputTokens: out.usage.outputTokens,
    totalTokens: out.usage.totalTokens,
    estimated: false,
  });
}

res.json({
  text,
  stopReason: out?.stopReason,
  usage: out?.usage,
  raw: req.query.raw === "1" ? out : undefined,
});

    } catch (e) {
      next(e);
    }
  });

  router.post("/chat/stream", async (req, res, next) => {
    try {
      const data = ChatSchema.parse(req.body);

      // SSE headers
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const command = new ConverseStreamCommand({
        modelId: data.modelId,
        system: data.system ? [{ text: data.system }] : undefined,
        messages: toBedrockMessages(data.messages),
        inferenceConfig: {
          temperature: data.temperature,
          topP: data.topP,
          maxTokens: data.maxTokens,
        },
      });

      const out = await clients.runtime.send(command);

      const send = (obj) => {
        res.write(`data: ${JSON.stringify(obj)}\n\n`);
      };

      send({ type: "start" });

      let lastUsage = null;

      // Stream format varies by SDK event shapes. We handle the common delta case.
      for await (const ev of out.stream) {
        const deltaText =
          ev?.contentBlockDelta?.delta?.text ||
          ev?.contentBlockDelta?.delta?.textDelta ||
          ev?.delta?.text ||
          null;

        if (deltaText) {
          send({ type: "delta", text: deltaText });
          continue;
        }

        // Some events include usage metadata near the end
        const usage = ev?.metadata?.usage || ev?.usage || null;
        if (usage) {
          send({ type: "usage", usage });
        }

        const stopReason =
          ev?.messageStop?.stopReason ||
          ev?.stopReason ||
          null;

        if (stopReason) {
          send({ type: "stop", stopReason });
        }
      }

// Store usage after streaming completes (if present)
if (lastUsage) {
  usageStore.add({
    kind: "converse",
    modelId: data.modelId,
    inputTokens: lastUsage.inputTokens,
    outputTokens: lastUsage.outputTokens,
    totalTokens: lastUsage.totalTokens,
    estimated: false,
  });
}

send({ type: "done" });
res.end();

    } catch (e) {
      // In SSE mode, send error as event then end.
      res.write(`data: ${JSON.stringify({ type: "error", message: e.message })}\n\n`);
      res.end();
    }
  });

  router.post("/rag", async (req, res, next) => {
    try {
      const data = RagSchema.parse(req.body);

      // RAG via Knowledge Bases (RetrieveAndGenerate)
      // knowledgeBaseId: 콘솔에서 생성한 KB ID
      // modelArnOrId: (선택) 생성 단계에서 사용한 모델 or 사용할 모델 ARN/ID
      const out = await clients.agentRuntime.send(
        new RetrieveAndGenerateCommand({
          input: { text: data.query },
          retrieveAndGenerateConfiguration: {
            type: "KNOWLEDGE_BASE",
            knowledgeBaseConfiguration: {
              knowledgeBaseId: data.knowledgeBaseId,
              modelArn: data.modelArnOrId, // optional
            },
          },
        })
      );

      const answer = out?.output?.text || "";

// Store a lightweight record for RAG (token usage may not be returned)
usageStore.add({
  kind: "rag",
  estimated: true,
  meta: { knowledgeBaseId: data.knowledgeBaseId },
});


      const citations = out?.citations || [];

      res.json({ answer, citations, raw: req.query.raw === "1" ? out : undefined });
    } catch (e) {
      next(e);
    }
  });


// ------------------------------------------------------------
// Agents for Amazon Bedrock (Runtime)
// - InvokeAgent: non-stream / stream (SSE)
//
// 필요 파라미터:
// - agentId, agentAliasId
// - sessionId (옵션): 같은 세션으로 이어서 대화 컨텍스트 유지
// - enableTrace (옵션): true면 trace 이벤트가 같이 올 수 있음
// - endSession (옵션): true면 세션 종료
// ------------------------------------------------------------

router.post("/agent/invoke", async (req, res, next) => {
  try {
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

    // InvokeAgent는 completion(이벤트 스트림)로 결과를 반환할 수 있습니다.
    // 여기서는 "비스트리밍"처럼 쓰기 위해 completion을 끝까지 읽어 텍스트를 합칩니다.
    let text = "";
    let trace = [];

    if (out?.completion) {
      for await (const ev of out.completion) {
        // data chunk
        if (ev?.chunk?.bytes) {
          text += bytesToUtf8(ev.chunk.bytes);
        }
        // trace chunk (optional)
        if (ev?.trace) {
          trace.push(ev.trace);
        }
      }
    }

    res.json({
      sessionId: out?.sessionId,
      text,
      trace: req.query.trace === "1" ? trace : undefined,
    });
  } catch (e) {
    next(e);
  }
});

router.post("/agent/stream", async (req, res) => {
  // SSE로 completion 이벤트를 실시간 전송
  try {
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

    if (out?.completion) {
      for await (const ev of out.completion) {
        if (ev?.chunk?.bytes) {
          const delta = bytesToUtf8(ev.chunk.bytes);
          if (delta) send({ type: "delta", text: delta });
        }
        if (ev?.trace) {
          // trace는 크기가 클 수 있어 토글로만 활성화 권장
          send({ type: "trace", trace: ev.trace });
        }
      }
    }

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
