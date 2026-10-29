import { z } from 'zod'

/** 地址只承担基础路径；禁止在 URL 中夹带另一套认证或切换接口协议。 */
export function normalizeBaseURL(raw: string): string | undefined {
  try {
    const url = new URL(raw.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
      || /\/(?:chat\/completions|responses|messages)\/?$/iu.test(url.pathname)) return undefined
    return url.href.replace(/\/+$/u, '')
  } catch { return undefined }
}
export const customDraftSchema = z.object({
  baseURL: z.string().min(1, '请填写 API 地址。').max(2048, 'API 地址过长。').refine(value => !!normalizeBaseURL(value), '请输入 http:// 或 https:// 基础地址，不含接口路径、查询参数或认证信息。'),
  model: z.string().trim().min(1, '请填写模型名称。').max(300, '模型名称最多 300 个字符。').refine(value => !/[\u0000-\u001f\u007f]/u.test(value), '模型名称不能包含控制字符。'),
})
export const apiKeySchema = z.string().trim().min(1).max(8192).refine(value => !/[\s\u0000-\u001f\u007f]/u.test(value), '请输入有效的 API Key。')
export const credentialIdSchema = z.string().regex(/^custom-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
export interface CustomKeyInfo { credential: string; configured: boolean; writable: boolean }
