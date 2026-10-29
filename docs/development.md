# 开发与验证

本页供维护者使用。功能和安装说明见[使用指南](./README.md)，首个版本为 **1.0.0**。

## 构建

需要 Node.js 24.9 以上，以及用于页面验收的本机 Edge 或 Chrome。

```text
npm ci --ignore-scripts
npm run build
npm run typecheck
npm run test:unit
npm run check:docs
```

## GitHub 安装分发

与 DSHM 电脑插件采用同一方式：仓库提交预编译的 `lib/`，用户执行 `dsh plugin --profile web add github:KKUCODES/deepseek-harness-predictions` 直接安装。不依赖安装时的 `prepare`、`install` 或 `prepack` 构建，也不需要用户授予额外构建许可。

修改源码后先执行 `npm run build`，将源码与 `lib/` 一起提交。首次发布前仍需推送到公开仓库，使用该 GitHub 命令在隔离 Web profile 完成实际安装与加载验证；本地打包成功不能代替这一步。

[Actions 配置](../.github/workflows/plugin-build.yml)在推送、PR 或手动触发时重新构建，使用 Git 差异与新增文件检查阻止陈旧或漏提交的 `lib/`，然后运行单元测试并上传 `.tgz` 构建产物。当前工作流不自动发布 Release。

## 官方 Web 回归

```text
npm run verify:stage1
npm run verify:settings
npm run verify:status
npm run verify:parameters
npm run verify:stage4
node scripts/verify-stage1.mjs --automatic-cycle --cached-model-from artifacts/stage2/2026-10-27T05-33-35-596Z-fb34b6d3/report.json
```

这些命令验证实际安装、设置、状态、参数及稳定性。脚本通过官方 CLI 将真实 tgz 安装至项目内的隔离 home，使用官方认证和原输入框，不修改宿主源码或日常配置。

参数和状态回归使用本地 Chat Completions 服务，不调用厂商。部分脚本需要项目 artifacts 中的真实会话样本，样本不随安装包分发；读取和验证方式见[验收说明](./project-knowledge/validation/README.md)。缺少样本时不能伪造会话或宣称全量通过。

真实厂商验证必须取得授权后显式选择，区分连接测试和实际预测。Key 不进入普通配置或报告，验证后清理隔离凭据；失败不自动增加收费请求。

## 文档

[知识库](./project-knowledge/catalog.md)维护当前接口、规则、设计和验证范围，版本变更见 [CHANGELOG](../CHANGELOG.md)。原始测试产物留在 artifacts，报告内容和包身份不改写。

修改接口或使用方式后同步用户指南和更新日志；有适用版本差异时如实标明。修改验证结论时记录实际入口与证据。
