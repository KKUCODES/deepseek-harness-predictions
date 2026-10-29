import assert from 'node:assert/strict'
import { readFile, readdir, writeFile, access, rm } from 'node:fs/promises'
import { resolve, relative, isAbsolute, join } from 'node:path'
import { readGlmKey } from './read-glm-key.mjs'

// 只在内存比对真实 Key；报告不记录匹配上下文或凭据内容。
const root = resolve(import.meta.dirname, '..')
const key = await readGlmKey(process.argv[2])
const inputs = process.argv.slice(3).map(path => resolve(root, path))
assert.ok(inputs.length > 0, '需要本项目内的验收输出目录')
const result = { verifiedAt: new Date().toISOString(), textFilesScanned: 0, secretMatches: [], runs: [],
  predictionUsage: { calls: 0, inputTokens: 0, outputTokens: 0, uncertainCalls: 0 } }
for (const directory of inputs) {
  assert.ok(['artifacts/undo', 'artifacts/glm-prediction-final'].some(base => {
    const owned = relative(join(root, base), directory)
    return owned && !owned.startsWith('..') && !isAbsolute(owned)
  }))
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name === 'node_modules') continue
      const file = join(path, entry.name)
      if (entry.isDirectory()) await walk(file)
      else if (/\.(?:json|jsonl|txt|html|log|ya?ml|js|mjs|cjs|map|md)$/iu.test(entry.name)) {
        result.textFilesScanned++
        if ((await readFile(file, 'utf8')).includes(key)) result.secretMatches.push(relative(root, file))
      }
    }
  }
  await walk(directory)
  const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'))
  let credentialsRemain = true
  try { await access(join(directory, 'home/.credentials.yaml')) } catch (error) { if (error.code === 'ENOENT') credentialsRemain = false; else throw error }
  const run = { report: relative(root, join(directory, 'report.json')), webVerified: report.webVerified,
    glmVerified: report.realGlmPredictions?.verified ?? false, hostStopped: report.hostStopped, listenerStopped: report.listenerStopped,
    officialFilesUnchanged: report.officialFilesUnchanged, credentialsRemain }
  result.runs.push(run)
  assert.equal(run.hostStopped, true); assert.equal(run.listenerStopped, true); assert.equal(run.officialFilesUnchanged, true)
  if (credentialsRemain) {
    // 无密钥的启动探测也会创建本机浏览器认证记录；仅清理已退出的本次验收 home。
    const file = join(directory, 'home/.credentials.yaml')
    assert.equal((await readFile(file, 'utf8')).includes(key), false)
    await rm(file)
    run.credentialsRemain = false
  }
  try {
    const usage = JSON.parse(await readFile(join(directory, 'home/storages/dsh_predictions_usage.json'), 'utf8'))
    for (const day of Object.values(usage.tables.daily)) for (const field of Object.keys(result.predictionUsage)) result.predictionUsage[field] += day[field]
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}
assert.deepEqual(result.secretMatches, [], '验收文本中发现真实 Key，必须清理后才能交付')
const path = join(root, 'artifacts/bigmodel-prediction-verification.json')
await writeFile(path, JSON.stringify(result, null, 2))
console.log(JSON.stringify({ report: path, ...result }))
