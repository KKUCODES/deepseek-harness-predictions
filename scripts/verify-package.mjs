import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const archive = join(root, 'artifacts', `kkucodes-dsh-predictions-${manifest.version}.tgz`)
assert.ok(process.argv[2], '请提供已经通过官方 Web 验收的 tgz 路径')
const tested = resolve(root, process.argv[2])
const list = path => execFileSync('tar', ['-tf', path], { cwd: root, windowsHide: true, encoding: 'utf8' }).trim().split(/\r?\n/u)
const runtime = list(archive).filter(name => name.startsWith('package/lib/') || name === 'package/cordis.patch.yml').sort()
assert.deepEqual(runtime, list(tested).filter(name => name.startsWith('package/lib/') || name === 'package/cordis.patch.yml').sort())
for (const file of runtime) {
  const extract = path => execFileSync('tar', ['-xOf', path, file], { cwd: root, windowsHide: true, maxBuffer: 10 * 1024 * 1024 })
  assert.ok(extract(archive).equals(extract(tested)), `交付包代码与实测包不同：${file}`)
}
const packedManifest = path => JSON.parse(execFileSync('tar', ['-xOf', path, 'package/package.json'], { cwd: root, windowsHide: true, encoding: 'utf8' }))
const current = packedManifest(archive), prior = packedManifest(tested)
// 开发命令和说明可补充；影响运行和安装的字段必须与实际验收一致。
for (const key of ['name', 'version', 'type', 'main', 'exports', 'engines', 'dsh', 'dependencies', 'peerDependencies']) {
  assert.deepEqual(current[key], prior[key], `交付包运行元数据变化：${key}`)
}
const bytes = await readFile(archive)
const report = { archive, tested, runtimeFilesIdentical: runtime.length, metadataIdentical: true, bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'), verifiedAt: new Date().toISOString() }
await writeFile(join(root, `artifacts/package-verification-${manifest.version}.json`), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
