import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
await mkdir(resolve(root, 'lib'), { recursive: true })
// 已移除的预算与官方定价模块不能残留在交付包中。
for (const file of ['budget.js', 'budget.js.map', 'budget.d.ts', 'pricing.js', 'pricing.js.map', 'pricing.d.ts']) await rm(resolve(root, 'lib', file), { force: true })
const typescript = spawn(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '--declaration', '--emitDeclarationOnly', '--outDir', 'lib'],
  { cwd: root, stdio: 'inherit', windowsHide: true })
const code = await new Promise((done, fail) => { typescript.once('exit', done); typescript.once('error', fail) })
if (code !== 0) process.exit(code ?? 1)

await build({ absWorkingDir: root, entryPoints: ['src/index.ts', 'src/config.ts', 'src/prediction.ts', 'src/usage.ts', 'src/custom-model.ts', 'src/request-parameters.ts', 'src/chat-completions.ts'], outdir: 'lib', bundle: true,
  platform: 'node', target: 'node24', format: 'esm', sourcemap: true, external: ['@deepseek-ai/*', 'zod'] })
await build({ absWorkingDir: root, entryPoints: ['src/client/index.tsx'], outfile: 'lib/client.js', bundle: true,
  platform: 'browser', target: 'es2022', format: 'cjs', sourcemap: true, loader: { '.svg': 'dataurl' }, external: ['react', 'react/jsx-runtime'],
  banner: { js: 'window.__ModuleLoader__.load({id:"@kkucodes/dsh-predictions",factory:(require)=>{var module={exports:{}};var exports=module.exports;' },
  footer: { js: 'return module.exports;}});' } })
console.log('插件已构建；真实预测默认关闭。')
