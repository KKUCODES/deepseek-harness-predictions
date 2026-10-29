import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const documents = ['AGENTS.md', 'README.md', 'README.en.md', 'CHANGELOG.md']
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await collect(path)
    else if (entry.name.endsWith('.md')) documents.push(path)
  }
}
await collect(join(root, 'docs'))
let count = 0
for (const name of documents) {
  const file = resolve(root, name)
  for (const match of (await readFile(file, 'utf8')).matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    const target = match[1].replace(/^<|>$/gu, '').split('#')[0]
    if (!target || /^[a-z]+:/iu.test(target)) continue
    const path = resolve(dirname(file), decodeURIComponent(target))
    try { await access(path) } catch { assert.fail(`本地链接不存在：${file} -> ${target}`) }
    count++
  }
}
console.log(`已检查 ${documents.length} 篇文档、${count} 个本地文件链接。`)
