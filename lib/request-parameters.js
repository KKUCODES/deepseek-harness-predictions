// src/request-parameters.ts
import { z } from "zod";
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
var parameterSchema = z.object({ key: z.string(), type: z.enum(["text", "number", "boolean", "json"]), value: z.string() }).strict();
var requestParametersSchema = z.object({
  maxTokensEnabled: z.boolean(),
  maxTokens: z.string(),
  parameters: z.array(parameterSchema)
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
var emptyRequestParameters = () => ({ maxTokensEnabled: false, maxTokens: "", parameters: [] });
var legacyRequestParameters = (tokens) => ({ maxTokensEnabled: true, maxTokens: String(tokens), parameters: [] });
function customRequestOf(config) {
  if (!config.customRequestConfigured) return config.customCredential ? legacyRequestParameters(config.outputTokens) : emptyRequestParameters();
  return requestParametersSchema.parse({
    maxTokensEnabled: config.customMaxTokensEnabled,
    maxTokens: config.customMaxTokens,
    parameters: JSON.parse(config.customParameters)
  });
}
function completionBody(model, messages, input) {
  const request = requestParametersSchema.parse(typeof input === "number" ? legacyRequestParameters(input) : input);
  const fields = [JSON.stringify({ model, messages, stream: false }).slice(1, -1)];
  if (request.maxTokensEnabled) fields.push('"max_tokens":' + request.maxTokens.trim().replace(/^0+(?=\d)/u, ""));
  for (const row of request.parameters) fields.push(JSON.stringify(row.key.trim()) + ":" + (row.type === "text" ? JSON.stringify(row.value) : row.value.trim()));
  return "{" + fields.join(",") + "}";
}
export {
  completionBody,
  customRequestOf,
  emptyRequestParameters,
  legacyRequestParameters,
  parameterSchema,
  requestParametersSchema
};
//# sourceMappingURL=request-parameters.js.map
