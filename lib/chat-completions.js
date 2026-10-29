// src/chat-completions.ts
import { attributionHeaders } from "@deepseek-ai/dsh-llm";
import { z as z3 } from "zod";

// src/custom-model.ts
import { z } from "zod";
function normalizeBaseURL(raw) {
  try {
    const url = new URL(raw.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || /\/(?:chat\/completions|responses|messages)\/?$/iu.test(url.pathname)) return void 0;
    return url.href.replace(/\/+$/u, "");
  } catch {
    return void 0;
  }
}
var customDraftSchema = z.object({
  baseURL: z.string().min(1, "\u8BF7\u586B\u5199 API \u5730\u5740\u3002").max(2048, "API \u5730\u5740\u8FC7\u957F\u3002").refine((value) => !!normalizeBaseURL(value), "\u8BF7\u8F93\u5165 http:// \u6216 https:// \u57FA\u7840\u5730\u5740\uFF0C\u4E0D\u542B\u63A5\u53E3\u8DEF\u5F84\u3001\u67E5\u8BE2\u53C2\u6570\u6216\u8BA4\u8BC1\u4FE1\u606F\u3002"),
  model: z.string().trim().min(1, "\u8BF7\u586B\u5199\u6A21\u578B\u540D\u79F0\u3002").max(300, "\u6A21\u578B\u540D\u79F0\u6700\u591A 300 \u4E2A\u5B57\u7B26\u3002").refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), "\u6A21\u578B\u540D\u79F0\u4E0D\u80FD\u5305\u542B\u63A7\u5236\u5B57\u7B26\u3002")
});
var apiKeySchema = z.string().trim().min(1).max(8192).refine((value) => !/[\s\u0000-\u001f\u007f]/u.test(value), "\u8BF7\u8F93\u5165\u6709\u6548\u7684 API Key\u3002");
var credentialIdSchema = z.string().regex(/^custom-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);

// src/request-parameters.ts
import { z as z2 } from "zod";
var reserved = /* @__PURE__ */ new Set([
  "model",
  "messages",
  "stream",
  "stream_options",
  "tools",
  "tool_choice",
  "functions",
  "function_call",
  "api_key",
  "apikey",
  "authorization",
  "headers",
  "baseurl",
  "base_url",
  "max_tokens",
  "__proto__",
  "constructor",
  "prototype"
]);
var jsonNumber = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u;
var positiveInteger = /^\d+$/u;
var parameterSchema = z2.object({ key: z2.string(), type: z2.enum(["text", "number", "boolean", "json"]), value: z2.string() }).strict();
var requestParametersSchema = z2.object({
  maxTokensEnabled: z2.boolean(),
  maxTokens: z2.string(),
  parameters: z2.array(parameterSchema)
}).strict().superRefine((value, ctx) => {
  const issue = (path, message) => ctx.addIssue({ code: "custom", path, message });
  if (value.maxTokensEnabled && (!positiveInteger.test(value.maxTokens.trim()) || !/[1-9]/u.test(value.maxTokens)))
    issue(["maxTokens"], "\u8BF7\u8F93\u5165\u5927\u4E8E\u6216\u7B49\u4E8E 1 \u7684\u6574\u6570\u3002");
  const keys = /* @__PURE__ */ new Set();
  value.parameters.forEach((row, index) => {
    const key = row.key.trim();
    const path = ["parameters", index];
    if (!key) issue([...path, "key"], "\u8BF7\u586B\u5199\u53C2\u6570\u540D\u3002");
    else if (/[\s\u0000-\u001f\u007f]/u.test(key)) issue([...path, "key"], "\u53C2\u6570\u540D\u4E0D\u80FD\u5305\u542B\u7A7A\u767D\u6216\u63A7\u5236\u5B57\u7B26\u3002");
    else if (reserved.has(key.toLowerCase())) issue([...path, "key"], key === "max_tokens" ? "\u8BF7\u4F7F\u7528\u4E0A\u65B9\u7684\u8F93\u51FA\u957F\u5EA6\u5F00\u5173\u3002" : "\u6B64\u5B57\u6BB5\u7531\u63D2\u4EF6\u7BA1\u7406\uFF0C\u4E0D\u80FD\u8986\u76D6\u3002");
    else if (key === "extra_body") issue([...path, "key"], "extra_body \u662F SDK \u5199\u6CD5\uFF0C\u8BF7\u76F4\u63A5\u586B\u5199\u5176\u4E2D\u7684\u53C2\u6570\u3002");
    else if (keys.has(key)) issue([...path, "key"], "\u53C2\u6570\u540D\u91CD\u590D\u3002");
    keys.add(key);
    if (key === "max_completion_tokens" && value.maxTokensEnabled)
      issue([...path, "key"], "\u4E0D\u80FD\u540C\u65F6\u8BBE\u7F6E max_tokens \u548C max_completion_tokens\uFF0C\u8BF7\u5173\u95ED\u4E0A\u65B9\u5F00\u5173\u6216\u5220\u9664\u6B64\u53C2\u6570\u3002");
    const raw = row.value.trim();
    if (row.type === "number" && !jsonNumber.test(raw)) issue([...path, "value"], "\u8BF7\u8F93\u5165\u6709\u6548\u6570\u5B57\u3002");
    if (row.type === "boolean" && raw !== "true" && raw !== "false") issue([...path, "value"], "\u8BF7\u9009\u62E9 true \u6216 false\u3002");
    if (row.type === "json") {
      try {
        JSON.parse(raw);
      } catch {
        issue([...path, "value"], "\u8BF7\u8F93\u5165\u6709\u6548 JSON\u3002");
      }
    }
    if (key === "max_completion_tokens" && !((row.type === "number" || row.type === "json") && /^[1-9]\d*$/u.test(raw)))
      issue([...path, "value"], "max_completion_tokens \u5FC5\u987B\u662F\u5927\u4E8E\u6216\u7B49\u4E8E 1 \u7684\u6574\u6570\uFF0C\u7C7B\u578B\u9009\u6570\u5B57\u6216 JSON\u3002");
  });
});
var legacyRequestParameters = (tokens) => ({ maxTokensEnabled: true, maxTokens: String(tokens), parameters: [] });
function completionBody(model, messages, input) {
  const request = requestParametersSchema.parse(typeof input === "number" ? legacyRequestParameters(input) : input);
  const fields = [JSON.stringify({ model, messages, stream: false }).slice(1, -1)];
  if (request.maxTokensEnabled) fields.push('"max_tokens":' + request.maxTokens.trim().replace(/^0+(?=\d)/u, ""));
  for (const row of request.parameters) fields.push(JSON.stringify(row.key.trim()) + ":" + (row.type === "text" ? JSON.stringify(row.value) : row.value.trim()));
  return "{" + fields.join(",") + "}";
}

// src/chat-completions.ts
var CustomModelError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
var usageSchema = z3.object({ prompt_tokens: z3.number().int().nonnegative(), completion_tokens: z3.number().int().nonnegative() });
var responseSchema = z3.object({ choices: z3.array(z3.object({
  index: z3.number().int(),
  finish_reason: z3.string().nullable(),
  message: z3.object({ role: z3.literal("assistant"), content: z3.string().nullable(), tool_calls: z3.array(z3.unknown()).optional(), function_call: z3.unknown().optional() })
})).min(1), usage: z3.unknown().optional() });
var bigModelErrors = {
  "1113": ["insufficient-balance", "\u670D\u52A1\u5546\u8D26\u6237\u4F59\u989D\u4E0D\u8DB3\uFF0C\u8BF7\u68C0\u67E5\u8D26\u6237\u8BA1\u8D39\u3002"],
  "1302": ["rate-limited", "\u670D\u52A1\u5546\u8BF7\u6C42\u901F\u7387\u53D7\u9650\uFF0C\u8BF7\u51CF\u5C11\u5E76\u53D1\u6216\u7A0D\u540E\u624B\u52A8\u91CD\u8BD5\u3002"],
  "1305": ["provider-busy", "\u8BE5\u6A21\u578B\u5F53\u524D\u7E41\u5FD9\uFF0C\u8BF7\u7A0D\u540E\u624B\u52A8\u91CD\u8BD5\u3002"],
  "1308": ["quota-exceeded", "\u670D\u52A1\u5546\u5957\u9910\u989D\u5EA6\u5DF2\u7528\u5C3D\uFF0C\u8BF7\u67E5\u770B\u670D\u52A1\u5546\u7684\u91CD\u7F6E\u65F6\u95F4\u3002"],
  "1309": ["plan-expired", "\u670D\u52A1\u5546 Coding Plan \u5957\u9910\u5DF2\u5230\u671F\u3002"],
  "1310": ["quota-exceeded", "\u670D\u52A1\u5546\u6BCF\u5468\u6216\u6BCF\u6708\u4F7F\u7528\u989D\u5EA6\u5DF2\u7528\u5C3D\u3002"],
  "1311": ["model-not-entitled", "\u5F53\u524D\u8BA2\u9605\u5957\u9910\u672A\u5F00\u653E\u8BE5\u6A21\u578B\u6743\u9650\uFF0C\u8BF7\u9009\u62E9\u5957\u9910\u652F\u6301\u7684\u6A21\u578B\u3002"],
  "1313": ["rate-limited", "\u670D\u52A1\u5546\u56E0\u516C\u5E73\u4F7F\u7528\u7B56\u7565\u9650\u5236\u4E86\u8BF7\u6C42\uFF0C\u8BF7\u67E5\u770B\u670D\u52A1\u5546\u8D26\u6237\u72B6\u6001\u3002"],
  "1314": ["plan-expired", "\u670D\u52A1\u5546\u4F01\u4E1A\u5957\u9910\u5DF2\u5931\u6548\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458\u3002"],
  "1315": ["credential-scope", "\u8BE5 API Key \u4EC5\u9650\u670D\u52A1\u5546\u4F01\u4E1A\u7F16\u7A0B\u5957\u9910\u573A\u666F\uFF0C\u8BF7\u68C0\u67E5 Key \u7C7B\u578B\u3002"]
};
async function readJSON(response, signal, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw new CustomModelError("invalid-response", "\u670D\u52A1\u672A\u8FD4\u56DE\u6709\u6548\u7684 Chat Completions \u54CD\u5E94\u3002");
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) throw new CustomModelError("invalid-response", "\u6A21\u578B\u54CD\u5E94\u8FC7\u5927\u3002");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {
    });
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new CustomModelError("invalid-response", "\u670D\u52A1\u672A\u8FD4\u56DE\u6709\u6548\u7684 Chat Completions JSON\u3002");
  }
}
async function chatCompletion(connection, messages, parameters, signal, onUsage = () => {
}) {
  const draft = customDraftSchema.parse(connection);
  const apiKey = apiKeySchema.parse(connection.apiKey);
  const body = completionBody(draft.model, messages, parameters);
  signal.throwIfAborted();
  let response;
  try {
    response = await fetch(normalizeBaseURL(draft.baseURL) + "/chat/completions", {
      method: "POST",
      redirect: "error",
      signal,
      headers: { ...attributionHeaders(), authorization: "Bearer " + apiKey, "content-type": "application/json", accept: "application/json" },
      body
    });
  } catch {
    signal.throwIfAborted();
    throw new CustomModelError("connection-failed", "\u65E0\u6CD5\u8FDE\u63A5\u5230\u670D\u52A1\uFF0C\u8BF7\u68C0\u67E5 API \u5730\u5740\u548C\u7F51\u7EDC\u3002");
  }
  if (!response.ok) {
    if (response.status === 429 && new URL(draft.baseURL).hostname === "open.bigmodel.cn") {
      let raw2;
      try {
        raw2 = await readJSON(response, signal, 16 * 1024);
      } catch {
        signal.throwIfAborted();
      }
      const parsed2 = z3.object({ error: z3.object({ code: z3.union([z3.string(), z3.number()]) }) }).safeParse(raw2);
      const providerCode = parsed2.success ? String(parsed2.data.error.code) : "";
      const known = /^\d{4}$/u.test(providerCode) ? bigModelErrors[providerCode] : void 0;
      if (known) throw new CustomModelError(known[0], known[1] + `\uFF08\u670D\u52A1\u7801 ${providerCode}\uFF09`);
    } else await response.body?.cancel();
    const [code, text] = response.status === 401 || response.status === 403 ? ["authentication-failed", "API Key \u65E0\u6548\u6216\u65E0\u6A21\u578B\u8BBF\u95EE\u6743\u9650\u3002"] : response.status === 404 ? ["model-unavailable", "\u627E\u4E0D\u5230\u63A5\u53E3\u6216\u6A21\u578B\uFF0C\u8BF7\u68C0\u67E5\u57FA\u7840\u5730\u5740\u548C\u6A21\u578B ID\u3002"] : response.status === 429 ? ["rate-limited", "\u670D\u52A1\u62D2\u7EDD\u8BF7\u6C42\uFF08HTTP 429\uFF09\uFF0C\u8BF7\u68C0\u67E5\u670D\u52A1\u5546\u9650\u989D\u548C\u6A21\u578B\u6743\u9650\u3002"] : response.status === 400 || response.status === 422 ? ["invalid-parameters", `\u670D\u52A1\u5546\u62D2\u7EDD\u8BF7\u6C42\u53C2\u6570\uFF08HTTP ${response.status}\uFF09\u3002\u8BF7\u68C0\u67E5\u8F93\u51FA\u4E0A\u9650\u3001\u53C2\u6570\u540D\u3001\u7C7B\u578B\u548C\u503C\u662F\u5426\u9002\u7528\u4E8E\u8BE5\u6A21\u578B\u3002`] : ["provider-failed", "\u6A21\u578B\u670D\u52A1\u62D2\u7EDD\u8BF7\u6C42\uFF0C\u8BF7\u68C0\u67E5 Chat Completions \u914D\u7F6E\u3002"];
    throw new CustomModelError(code, text);
  }
  const raw = await readJSON(response, signal, 1024 * 1024);
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new CustomModelError("invalid-response", "\u670D\u52A1\u8FD4\u56DE\u683C\u5F0F\u4E0D\u517C\u5BB9 Chat Completions\u3002");
  const usage = usageSchema.safeParse(parsed.data.usage);
  onUsage(usage.success ? { inputTokens: usage.data.prompt_tokens, outputTokens: usage.data.completion_tokens } : void 0);
  const choice = parsed.data.choices.find((choice2) => choice2.index === 0);
  if (!choice || choice.finish_reason !== "stop" || choice.message.tool_calls?.length || choice.message.function_call || typeof choice.message.content !== "string" || !choice.message.content.trim()) {
    throw new CustomModelError("incomplete-response", choice?.finish_reason === "length" ? "\u8F93\u51FA\u8FBE\u5230\u670D\u52A1\u5546\u8FD4\u56DE\u7684\u957F\u5EA6\u4E0A\u9650\uFF0C\u9884\u6D4B\u672A\u5B8C\u6210\u3002\u8BF7\u8C03\u9AD8\u6216\u5173\u95ED\u8F93\u51FA\u957F\u5EA6\u9650\u5236\uFF0C\u5E76\u68C0\u67E5\u601D\u8003\u53C2\u6570\uFF1B\u601D\u8003\u4E5F\u53EF\u80FD\u6D88\u8017\u8F93\u51FA\u989D\u5EA6\u3002" : "\u6A21\u578B\u672A\u8FD4\u56DE\u5B8C\u6574\u7684\u6587\u672C\u9884\u6D4B\u3002\u8BF7\u68C0\u67E5\u81EA\u5B9A\u4E49\u53C2\u6570\u548C\u670D\u52A1\u5546\u8FD4\u56DE\u683C\u5F0F\u540E\u624B\u52A8\u91CD\u8BD5\u3002");
  }
  return choice.message.content;
}
export {
  CustomModelError,
  chatCompletion
};
//# sourceMappingURL=chat-completions.js.map
