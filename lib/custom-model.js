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
export {
  apiKeySchema,
  credentialIdSchema,
  customDraftSchema,
  normalizeBaseURL
};
//# sourceMappingURL=custom-model.js.map
