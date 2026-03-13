const DEFAULT_PLANS = {
  free: {
    key: "free",
    name: "Free",
    monthlyTokenLimit: 200000,
    rpm: 30,
    allowRag: true,
    allowAgents: false,
  },
  pro: {
    key: "pro",
    name: "Pro",
    monthlyTokenLimit: 2000000,
    rpm: 120,
    allowRag: true,
    allowAgents: true,
  },
  enterprise: {
    key: "enterprise",
    name: "Enterprise",
    monthlyTokenLimit: 20000000,
    rpm: 600,
    allowRag: true,
    allowAgents: true,
  },
};

function parseApiKeys(raw = "") {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [tenantId, apiKey, plan = "free"] = pair.split(":").map((s) => s.trim());
      if (!tenantId || !apiKey) return null;
      return { tenantId, apiKey, plan };
    })
    .filter(Boolean);
}

const tenantByApiKey = new Map();
const tenantById = new Map();

for (const item of parseApiKeys(process.env.SAAS_API_KEYS || "")) {
  const plan = DEFAULT_PLANS[item.plan] ? item.plan : "free";
  const tenant = { tenantId: item.tenantId, plan };
  tenantByApiKey.set(item.apiKey, tenant);
  tenantById.set(item.tenantId, tenant);
}

if (!tenantById.size) {
  const bootstrap = { tenantId: "demo-tenant", plan: "free" };
  tenantById.set(bootstrap.tenantId, bootstrap);
}

const currentMonthKey = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

const usageByTenantMonth = new Map();

function resolveTenant(req) {
  const apiKey = req.header("x-api-key");
  const tenantFromKey = apiKey ? tenantByApiKey.get(apiKey) : null;
  const tenantIdHeader = req.header("x-tenant-id");

  if (tenantFromKey) return tenantFromKey;
  if (tenantIdHeader && tenantById.has(tenantIdHeader)) return tenantById.get(tenantIdHeader);
  return tenantById.get("demo-tenant") || { tenantId: "demo-tenant", plan: "free" };
}

function getPlan(planKey) {
  return DEFAULT_PLANS[planKey] || DEFAULT_PLANS.free;
}

function addUsage(tenantId, tokens = 0) {
  const month = currentMonthKey();
  const key = `${tenantId}:${month}`;
  const prev = usageByTenantMonth.get(key) || 0;
  usageByTenantMonth.set(key, prev + Math.max(0, Number(tokens) || 0));
  return usageByTenantMonth.get(key);
}

function getUsage(tenantId) {
  const month = currentMonthKey();
  return usageByTenantMonth.get(`${tenantId}:${month}`) || 0;
}

function listPlans() {
  return Object.values(DEFAULT_PLANS);
}

function listTenants() {
  return [...tenantById.values()];
}

module.exports = {
  resolveTenant,
  getPlan,
  addUsage,
  getUsage,
  listPlans,
  listTenants,
};
