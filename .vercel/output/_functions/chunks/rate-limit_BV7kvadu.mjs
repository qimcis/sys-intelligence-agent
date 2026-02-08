const MODELS = {
  generator: "gpt-5-nano-2025-08-07",
  judge: "gpt-5-mini-2025-08-07"
};
async function callOpenAI(messages, apiKey, model = MODELS.generator) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      max_completion_tokens: 128e3
    })
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }
  const data = await response.json();
  const content = data.choices[0]?.message?.content;
  if (content === null || content === void 0) {
    const usage = data.usage;
    throw new Error(
      `OpenAI returned empty content. Usage: ${JSON.stringify(usage)}. This may indicate the model spent all tokens on reasoning. Try increasing max_completion_tokens or simplifying the prompt.`
    );
  }
  return content;
}

const openaiClient = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  MODELS,
  callOpenAI
}, Symbol.toStringTag, { value: 'Module' }));

const store = /* @__PURE__ */ new Map();
const CLEANUP_INTERVAL = 6e4;
let lastCleanup = Date.now();
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now >= entry.resetAt) {
      store.delete(key);
    }
  }
}
function checkRateLimit(ip, windowMs, maxRequests) {
  cleanup();
  const now = Date.now();
  const key = `${ip}`;
  const entry = store.get(key);
  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  if (entry.count < maxRequests) {
    entry.count++;
    return { allowed: true };
  }
  const retryAfter = Math.ceil((entry.resetAt - now) / 1e3);
  return { allowed: false, retryAfter };
}

export { MODELS as M, callOpenAI as a, checkRateLimit as c, openaiClient as o };
