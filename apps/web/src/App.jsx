import React, { useEffect, useMemo, useState } from "react";

const DEFAULT_MODEL_HINT = "먼저 우측 상단 'Load Models'로 modelId를 가져오세요.";

// Guardrails pricing (USD) - based on AWS pricing page (see labs/08_cost_calculator.md)
const GUARDRAILS = {
  textUnitChars: 1000,
  contentFiltersTextPer1kTextUnits: 0.15,
  deniedTopicsPer1kTextUnits: 0.15,
  sensitiveInfoPer1kTextUnits: 0.10,
  contextualGroundingPer1kTextUnits: 0.10,
  automatedReasoningPer1kTextUnitsPerPolicy: 0.17,
};

function useLocalStorageState(key, initial) {
  const [v, setV] = useState(() => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : initial;
  });
  useEffect(() => localStorage.setItem(key, JSON.stringify(v)), [key, v]);
  return [v, setV];
}

// Rough token estimator (very approximate):
// - English-like text: ~4 chars/token
// - Korean-like text: ~2 chars/token (rougher)
// Always allow manual override in the UI.
function estimateTokensByChars(text, mode) {
  const chars = (text || "").length;
  const divisor = mode === "ko" ? 2 : 4;
  return Math.max(1, Math.ceil(chars / divisor));
}

function money(n) {
  if (!isFinite(n)) return "-";
  return "$" + n.toFixed(6);
}

function num(n, digits = 1) {
  if (!isFinite(n)) return "-";
  return Number(n).toFixed(digits);
}

export default function App() {
  const [tab, setTab] = useLocalStorageState("tab", "chat");

  // Models/Converse chat
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useLocalStorageState("modelId", "");
  const [system, setSystem] = useLocalStorageState("system", "");
  const [temperature, setTemperature] = useLocalStorageState("temperature", 0.3);
  const [maxTokens, setMaxTokens] = useLocalStorageState("maxTokens", 512);
  const [stream, setStream] = useLocalStorageState("stream", true);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);

  // Agents
  const [agentId, setAgentId] = useLocalStorageState("agentId", "");
  const [agentAliasId, setAgentAliasId] = useLocalStorageState("agentAliasId", "");
  const [agentSessionId, setAgentSessionId] = useLocalStorageState("agentSessionId", "");
  const [agentStream, setAgentStream] = useLocalStorageState("agentStream", true);
  const [agentTrace, setAgentTrace] = useLocalStorageState("agentTrace", false);

  // Cost Calculator
  const [priceIn, setPriceIn] = useLocalStorageState("priceIn", 0.0);   // USD per 1k input tokens
  const [priceOut, setPriceOut] = useLocalStorageState("priceOut", 0.0); // USD per 1k output tokens
  const [reqCount, setReqCount] = useLocalStorageState("reqCount", 1000); // requests for period

  const [samplePrompt, setSamplePrompt] = useLocalStorageState("samplePrompt", "");
  const [sampleAnswer, setSampleAnswer] = useLocalStorageState("sampleAnswer", "");

  const [tokenMode, setTokenMode] = useLocalStorageState("tokenMode", "ko"); // ko | en
  const [manualTokens, setManualTokens] = useLocalStorageState("manualTokens", false);
  const [inputTokens, setInputTokens] = useLocalStorageState("inputTokens", 800);
  const [outputTokens, setOutputTokens] = useLocalStorageState("outputTokens", 400);

  // Recent usage from API
  const [usageSummary, setUsageSummary] = useState(null);
  const [usageItems, setUsageItems] = useState([]);

  // Guardrails options
  const [grContent, setGrContent] = useLocalStorageState("grContent", true);
  const [grDenied, setGrDenied] = useLocalStorageState("grDenied", false);
  const [grSensitive, setGrSensitive] = useLocalStorageState("grSensitive", false);
  const [grContextual, setGrContextual] = useLocalStorageState("grContextual", false);
  const [grAutoReasoning, setGrAutoReasoning] = useLocalStorageState("grAutoReasoning", false);
  const [grAutoPolicies, setGrAutoPolicies] = useLocalStorageState("grAutoPolicies", 1);

  const canSend = useMemo(() => modelId && input.trim().length, [modelId, input]);
  const canSendAgent = useMemo(
    () => agentId && agentAliasId && input.trim().length,
    [agentId, agentAliasId, input]
  );

  // Auto-estimate tokens from sample text unless manual override
  useEffect(() => {
    if (!manualTokens) {
      setInputTokens(estimateTokensByChars(samplePrompt, tokenMode));
      setOutputTokens(estimateTokensByChars(sampleAnswer, tokenMode));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samplePrompt, sampleAnswer, tokenMode, manualTokens]);

  // Fetch recent usage when entering cost tab
  useEffect(() => {
    if (tab !== "cost") return;
    (async () => {
      try {
        const [s, l] = await Promise.all([
          fetch("/api/usage/summary?limit=100").then((r) => r.json()),
          fetch("/api/usage/recent?limit=20").then((r) => r.json()),
        ]);
        setUsageSummary(s);
        setUsageItems(l.items || []);
      } catch (e) {
        console.warn("usage fetch failed", e);
      }
    })();
  }, [tab]);

  const totalLLMCostPerReq = useMemo(() => {
    const inCost = (Number(inputTokens) / 1000) * Number(priceIn || 0);
    const outCost = (Number(outputTokens) / 1000) * Number(priceOut || 0);
    return inCost + outCost;
  }, [inputTokens, outputTokens, priceIn, priceOut]);

  const totalLLMCostPeriod = useMemo(() => totalLLMCostPerReq * Number(reqCount || 0), [totalLLMCostPerReq, reqCount]);

  const guardrailTextUnitsPerReq = useMemo(() => {
    const chars = (samplePrompt || "").length + (sampleAnswer || "").length;
    return Math.max(1, Math.ceil(chars / GUARDRAILS.textUnitChars));
  }, [samplePrompt, sampleAnswer]);

  const guardrailsRatePer1kTextUnits = useMemo(() => {
    let rate = 0;
    if (grContent) rate += GUARDRAILS.contentFiltersTextPer1kTextUnits;
    if (grDenied) rate += GUARDRAILS.deniedTopicsPer1kTextUnits;
    if (grSensitive) rate += GUARDRAILS.sensitiveInfoPer1kTextUnits;
    if (grContextual) rate += GUARDRAILS.contextualGroundingPer1kTextUnits;
    if (grAutoReasoning) rate += GUARDRAILS.automatedReasoningPer1kTextUnitsPerPolicy * Math.max(1, Number(grAutoPolicies || 1));
    return rate;
  }, [grContent, grDenied, grSensitive, grContextual, grAutoReasoning, grAutoPolicies]);

  const guardrailsCostPerReq = useMemo(() => {
    // priced per 1,000 text units
    return (guardrailTextUnitsPerReq / 1000) * guardrailsRatePer1kTextUnits;
  }, [guardrailTextUnitsPerReq, guardrailsRatePer1kTextUnits]);

  const guardrailsCostPeriod = useMemo(() => guardrailsCostPerReq * Number(reqCount || 0), [guardrailsCostPerReq, reqCount]);

  const totalPeriod = useMemo(() => totalLLMCostPeriod + guardrailsCostPeriod, [totalLLMCostPeriod, guardrailsCostPeriod]);

  // Usage-based cost
  const usageAvgCostPerReq = useMemo(() => {
    if (!usageSummary) return 0;
    const inCost = (Number(usageSummary.avgInputTokens || 0) / 1000) * Number(priceIn || 0);
    const outCost = (Number(usageSummary.avgOutputTokens || 0) / 1000) * Number(priceOut || 0);
    return inCost + outCost;
  }, [usageSummary, priceIn, priceOut]);

  const usagePeriodCost = useMemo(() => usageAvgCostPerReq * Number(reqCount || 0), [usageAvgCostPerReq, reqCount]);

  async function loadModels() {
    const r = await fetch("/api/models");
    const j = await r.json();
    setModels(j.models || []);
    if (!modelId && j.models?.[0]?.modelId) setModelId(j.models[0].modelId);
  }

  async function sendOnce() {
    const next = [...messages, { role: "user", content: input }];
    setMessages(next);
    setInput("");

    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId,
        system: system || undefined,
        messages: next,
        temperature: Number(temperature),
        maxTokens: Number(maxTokens),
      }),
    });
    let j;
try {
  j = await (async () => {
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`HTTP ${r.status}: ${t}`);
    }
    if (ct.includes("application/json")) {
      return await r.json();
    }
    const t = await r.text();
    throw new Error(`Non-JSON response: ${t.slice(0, 500)}`);

  })();
} catch (e) {
  console.error(e);
  setMessages([...next, { role: "assistant", content: `❌ ${e.message}` }]);
  return;
}
setMessages([...next, { role: "assistant", content: j.text || "(no text)" }]);

  }

  async function sendStream() {
    const next = [...messages, { role: "user", content: input }];
    setMessages(next);
    setInput("");

    const r = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId,
        system: system || undefined,
        messages: next,
        temperature: Number(temperature),
        maxTokens: Number(maxTokens),
      }),
    });

    const reader = r.body.getReader();
    const decoder = new TextDecoder("utf-8");

    let buffer = "";
    let assistant = "";

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;

        const payload = JSON.parse(line.slice(6));
        if (payload.type === "delta") {
          assistant += payload.text;
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: "assistant", content: assistant };
            return copy;
          });
        }
      }
    }
  }

  async function onSend() {
    if (!canSend) return;
    if (stream) return sendStream();
    return sendOnce();
  }

  // Agents invoke
  async function invokeAgentOnce() {
    const next = [...messages, { role: "user", content: input }];
    setMessages(next);
    setInput("");

    const r = await fetch("/api/agent/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId,
        agentAliasId,
        sessionId: agentSessionId || undefined,
        inputText: next[next.length - 1].content,
        enableTrace: !!agentTrace,
      }),
    });
    let j;
try {
  j = await (async () => {
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`HTTP ${r.status}: ${t}`);
    }
    if (ct.includes("application/json")) {
      return await r.json();
    }
    const t = await r.text();
    throw new Error(`Non-JSON response: ${t.slice(0, 500)}`);

  })();
} catch (e) {
  console.error(e);
  setMessages([...next, { role: "assistant", content: `❌ ${e.message}` }]);
  return;
}
if (j.sessionId) setAgentSessionId(j.sessionId);
setMessages([...next, { role: "assistant", content: j.text || "(no text)" }]);

  }

  async function invokeAgentStream() {
    const next = [...messages, { role: "user", content: input }];
    setMessages(next);
    setInput("");

    const r = await fetch("/api/agent/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId,
        agentAliasId,
        sessionId: agentSessionId || undefined,
        inputText: next[next.length - 1].content,
        enableTrace: !!agentTrace,
      }),
    });

    const reader = r.body.getReader();
    const decoder = new TextDecoder("utf-8");

    let buffer = "";
    let assistant = "";

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;

        const payload = JSON.parse(line.slice(6));

        if (payload.type === "start" && payload.sessionId) {
          setAgentSessionId(payload.sessionId);
        }

        if (payload.type === "delta") {
          assistant += payload.text;
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: "assistant", content: assistant };
            return copy;
          });
        }
      }
    }
  }

  async function onSendAgent() {
    if (!canSendAgent) return;
    if (agentStream) return invokeAgentStream();
    return invokeAgentOnce();
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 16, maxWidth: 1180, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Amazon Bedrock Course UI</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={loadModels}>Load Models</button>
          <button onClick={() => setTab("chat")} disabled={tab === "chat"}>Chat</button>
          <button onClick={() => setTab("agents")} disabled={tab === "agents"}>Agents</button>
          <button onClick={() => setTab("cost")} disabled={tab === "cost"}>Cost</button>
        </div>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16, marginTop: 16 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Settings</h3>

          {tab === "chat" ? (
            <>
              <label style={{ display: "block", marginBottom: 8 }}>
                Model ID
                <select value={modelId} onChange={(e) => setModelId(e.target.value)} style={{ width: "100%" }}>
                  <option value="">{DEFAULT_MODEL_HINT}</option>
                  {models.map((m) => (
                    <option key={m.modelId} value={m.modelId}>
                      {m.providerName} / {m.modelId}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "block", marginBottom: 8 }}>
                System prompt (optional)
                <textarea value={system} onChange={(e) => setSystem(e.target.value)} rows={3} style={{ width: "100%" }} />
              </label>

              <label style={{ display: "block", marginBottom: 8 }}>
                Temperature
                <input type="number" step="0.1" min="0" max="2" value={temperature}
                  onChange={(e) => setTemperature(e.target.value)} style={{ width: "100%" }} />
              </label>

              <label style={{ display: "block", marginBottom: 8 }}>
                Max tokens
                <input type="number" min="1" max="4096" value={maxTokens}
                  onChange={(e) => setMaxTokens(e.target.value)} style={{ width: "100%" }} />
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                <input type="checkbox" checked={stream} onChange={(e) => setStream(e.target.checked)} />
                Stream (SSE)
              </label>
            </>
          ) : tab === "agents" ? (
            <>
              <p style={{ marginTop: 0, opacity: 0.8 }}>
                콘솔에서 Agent 생성 후 <b>agentId</b> / <b>agentAliasId</b>를 입력하세요.
              </p>

              <label style={{ display: "block", marginBottom: 8 }}>
                Agent ID
                <input value={agentId} onChange={(e) => setAgentId(e.target.value)} style={{ width: "100%" }} />
              </label>

              <label style={{ display: "block", marginBottom: 8 }}>
                Agent Alias ID
                <input value={agentAliasId} onChange={(e) => setAgentAliasId(e.target.value)} style={{ width: "100%" }} />
              </label>

              <label style={{ display: "block", marginBottom: 8 }}>
                Session ID (optional)
                <input value={agentSessionId} onChange={(e) => setAgentSessionId(e.target.value)} style={{ width: "100%" }} />
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                <input type="checkbox" checked={agentStream} onChange={(e) => setAgentStream(e.target.checked)} />
                Stream (SSE)
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <input type="checkbox" checked={agentTrace} onChange={(e) => setAgentTrace(e.target.checked)} />
                Enable trace (helps usage extraction)
              </label>
            </>
          ) : (
            <>
              <p style={{ marginTop: 0, opacity: 0.8 }}>
                <b>입력/출력 토큰 단가</b>와 <b>요청 수</b>를 넣으면 예상 비용을 계산합니다.
                (모델별 단가는 Bedrock Pricing 페이지에서 확인 후 입력)
              </p>

              <label style={{ display: "block", marginBottom: 8 }}>
                Price per 1,000 input tokens (USD)
                <input type="number" step="0.000001" min="0" value={priceIn}
                  onChange={(e) => setPriceIn(e.target.value)} style={{ width: "100%" }} />
              </label>

              <label style={{ display: "block", marginBottom: 8 }}>
                Price per 1,000 output tokens (USD)
                <input type="number" step="0.000001" min="0" value={priceOut}
                  onChange={(e) => setPriceOut(e.target.value)} style={{ width: "100%" }} />
              </label>

              <label style={{ display: "block", marginBottom: 8 }}>
                Requests (period)
                <input type="number" step="1" min="0" value={reqCount}
                  onChange={(e) => setReqCount(e.target.value)} style={{ width: "100%" }} />
              </label>

              <hr style={{ margin: "16px 0" }} />

              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={manualTokens} onChange={(e) => setManualTokens(e.target.checked)} />
                Manual token input (text-based estimate off)
              </label>

              {!manualTokens ? (
                <>
                  <label style={{ display: "block", marginTop: 10, marginBottom: 8 }}>
                    Token estimate mode
                    <select value={tokenMode} onChange={(e) => setTokenMode(e.target.value)} style={{ width: "100%" }}>
                      <option value="ko">Korean-ish (chars/2)</option>
                      <option value="en">English-ish (chars/4)</option>
                    </select>
                  </label>
                </>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                <label style={{ display: "block" }}>
                  Input tokens / request
                  <input type="number" step="1" min="1" value={inputTokens}
                    onChange={(e) => setInputTokens(e.target.value)} style={{ width: "100%" }} />
                </label>
                <label style={{ display: "block" }}>
                  Output tokens / request
                  <input type="number" step="1" min="1" value={outputTokens}
                    onChange={(e) => setOutputTokens(e.target.value)} style={{ width: "100%" }} />
                </label>
              </div>

              <hr style={{ margin: "16px 0" }} />

              <div style={{ fontSize: 13, opacity: 0.9 }}>
                <div><b>Manual/Estimated LLM per request:</b> {money((Number(inputTokens)/1000)*(Number(priceIn||0)) + (Number(outputTokens)/1000)*(Number(priceOut||0)))}</div>
                <div><b>Manual/Estimated for period:</b> {money(((Number(inputTokens)/1000)*(Number(priceIn||0)) + (Number(outputTokens)/1000)*(Number(priceOut||0))) * Number(reqCount||0))}</div>
              </div>
            </>
          )}

          <hr style={{ margin: "16px 0" }} />

          <button
            onClick={async () => {
              const r = await fetch("/api/health");
              alert(await r.text());
            }}
          >
            Health Check
          </button>

          {tab === "agents" && (
            <button style={{ marginLeft: 8 }} onClick={() => setAgentSessionId("")}>
              Reset Session
            </button>
          )}

          {tab === "cost" && (
            <button style={{ marginLeft: 8 }} onClick={async () => {
              const [s, l] = await Promise.all([
                fetch("/api/usage/summary?limit=100").then((r) => r.json()),
                fetch("/api/usage/recent?limit=20").then((r) => r.json()),
              ]);
              setUsageSummary(s);
              setUsageItems(l.items || []);
            }}>
              Refresh usage
            </button>
          )}
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>
            {tab === "chat" ? "Chat (Converse)" : tab === "agents" ? "Agents (InvokeAgent)" : "Cost (manual + usage-based)"}
          </h3>

          {tab !== "cost" ? (
            <>
              <div style={{ height: 420, overflow: "auto", padding: 8, border: "1px solid #eee", borderRadius: 8 }}>
                {messages.length === 0 ? (
                  <div style={{ opacity: 0.7 }}>메시지를 보내보세요.</div>
                ) : (
                  messages.map((m, idx) => (
                    <div key={idx} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>{m.role}</div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                    </div>
                  ))
                )}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  rows={3}
                  style={{ flex: 1 }}
                  placeholder={tab === "chat" ? "질문을 입력하세요..." : "Agent에게 보낼 inputText를 입력하세요..."}
                />
                <button onClick={tab === "chat" ? onSend : onSendAgent} disabled={tab === "chat" ? !canSend : !canSendAgent}>
                  Send
                </button>
              </div>

              {tab === "agents" && (
                <div style={{ marginTop: 8, opacity: 0.8, fontSize: 12 }}>
                  sessionId: <code>{agentSessionId || "(empty)"}</code>
                </div>
              )}
            </>
          ) : (
            <>
              <p style={{ marginTop: 0, opacity: 0.85 }}>
                아래는 두 가지 방식으로 비용을 봅니다:
                <br />
                1) <b>Manual/Estimated</b>: 입력한 토큰(또는 텍스트 기반 추정)으로 계산
                <br />
                2) <b>Usage-based</b>: 서버가 기록한 최근 N회 usage 평균으로 계산
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "block" }}>
                  Sample prompt (input) — used only for estimation & Guardrails text units
                  <textarea value={samplePrompt} onChange={(e) => setSamplePrompt(e.target.value)} rows={8} style={{ width: "100%" }} />
                </label>
                <label style={{ display: "block" }}>
                  Sample answer (output)
                  <textarea value={sampleAnswer} onChange={(e) => setSampleAnswer(e.target.value)} rows={8} style={{ width: "100%" }} />
                </label>
              </div>

              <hr style={{ margin: "14px 0" }} />

              <h4 style={{ margin: "0 0 8px 0" }}>Recent usage summary (from API)</h4>
              {usageSummary ? (
                <div style={{ fontSize: 13, opacity: 0.92 }}>
                  <div>window: <b>{usageSummary.window}</b>, count(with tokens): <b>{usageSummary.count}</b></div>
                  <div>avg input tokens: <b>{num(usageSummary.avgInputTokens, 1)}</b></div>
                  <div>avg output tokens: <b>{num(usageSummary.avgOutputTokens, 1)}</b></div>
                  <div>avg total tokens: <b>{num(usageSummary.avgTotalTokens, 1)}</b></div>
                  <div>avg LLM cost / request: <b>{money(usageAvgCostPerReq)}</b></div>
                  <div>LLM cost for period({reqCount} req): <b>{money(usagePeriodCost)}</b></div>
                  <div style={{ marginTop: 6, opacity: 0.8 }}>last: {usageSummary.lastTs || "-"}</div>
                  <div style={{ marginTop: 6, opacity: 0.8 }}>
                    Agent requests may show <code>estimated=true</code> if token usage wasn't available.
                  </div>
                </div>
              ) : (
                <div style={{ opacity: 0.7 }}>usage 데이터가 아직 없습니다. Chat/Agents로 몇 번 호출 후 Refresh 해보세요.</div>
              )}

              <hr style={{ margin: "14px 0" }} />

              <h4 style={{ margin: "0 0 8px 0" }}>Recent usage (latest 20)</h4>
              <div style={{ maxHeight: 220, overflow: "auto", border: "1px solid #eee", borderRadius: 8, padding: 8 }}>
                {usageItems.length === 0 ? (
                  <div style={{ opacity: 0.7 }}>No items</div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                        <th style={{ padding: "6px 4px" }}>ts</th>
                        <th style={{ padding: "6px 4px" }}>kind</th>
                        <th style={{ padding: "6px 4px" }}>in</th>
                        <th style={{ padding: "6px 4px" }}>out</th>
                        <th style={{ padding: "6px 4px" }}>total</th>
                        <th style={{ padding: "6px 4px" }}>estimated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usageItems.map((u, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid #f3f3f3" }}>
                          <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>{u.ts?.slice(5, 19)?.replace("T", " ")}</td>
                          <td style={{ padding: "6px 4px" }}>{u.kind}</td>
                          <td style={{ padding: "6px 4px" }}>{u.inputTokens ?? "-"}</td>
                          <td style={{ padding: "6px 4px" }}>{u.outputTokens ?? "-"}</td>
                          <td style={{ padding: "6px 4px" }}>{u.totalTokens ?? "-"}</td>
                          <td style={{ padding: "6px 4px" }}>{String(!!u.estimated)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <hr style={{ margin: "14px 0" }} />

              <h4 style={{ margin: "0 0 8px 0" }}>Guardrails (optional, estimation only)</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={grContent} onChange={(e) => setGrContent(e.target.checked)} />
                  Content filters (text)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={grDenied} onChange={(e) => setGrDenied(e.target.checked)} />
                  Denied topics
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={grSensitive} onChange={(e) => setGrSensitive(e.target.checked)} />
                  Sensitive information filters
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={grContextual} onChange={(e) => setGrContextual(e.target.checked)} />
                  Contextual grounding checks
                </label>

                <div style={{ gridColumn: "1 / span 2" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="checkbox" checked={grAutoReasoning} onChange={(e) => setGrAutoReasoning(e.target.checked)} />
                    Automated reasoning checks
                  </label>
                  {grAutoReasoning ? (
                    <label style={{ display: "block", marginTop: 6 }}>
                      Number of automated reasoning policies
                      <input type="number" min="1" step="1" value={grAutoPolicies} onChange={(e) => setGrAutoPolicies(e.target.value)} />
                    </label>
                  ) : null}
                </div>
              </div>

              <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9 }}>
                text units / request: <b>{Math.max(1, Math.ceil(((samplePrompt||"").length + (sampleAnswer||"").length) / 1000))}</b> / rate(per 1,000 text units): <b>{money((grContent?0.15:0) + (grDenied?0.15:0) + (grSensitive?0.10:0) + (grContextual?0.10:0) + (grAutoReasoning?(0.17*Math.max(1, Number(grAutoPolicies||1))):0))}</b>
              </div>
            </>
          )}
        </div>
      </section>

      <footer style={{ marginTop: 18, opacity: 0.7 }}>
        <small>API proxy: /api → localhost:8080</small>
      </footer>
    </div>
  );
}
