import { readFile } from 'node:fs/promises'

/** 仅显式真实诊断使用；不复制用户文件，不解析或使用同文件中的其他厂商密钥。 */
export async function readGlmKey(path) {
  const line = (await readFile(path, 'utf8')).split(/\r?\n/u).find(line => /\bGLM\b/iu.test(line))
  const candidates = [...(line ?? '').matchAll(/[A-Za-z0-9_-]{16,}(?:\.[A-Za-z0-9_-]{8,})*/gu)].map(match => match[0])
  if (candidates.length !== 1) throw new Error('无法唯一识别 GLM 密钥；未发送请求')
  return candidates[0]
}
