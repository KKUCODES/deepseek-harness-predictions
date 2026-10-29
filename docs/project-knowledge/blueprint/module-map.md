# 插件模块地图

状态：1.0.0 当前实现。维护角色：插件维护者。最近核验：2026-10-29。

## 边界与数据流

插件通过宿主已有的设置、投影、输入状态、草稿、快捷键、模型和凭据服务工作，不替换原输入框，不改宿主源码或安装文件。

会话投影与设置 → 页面共享请求 → 宿主认证路由 → 插件独立去重存储 → 模型 → 灰字 → 用户按键 → 宿主公开草稿接口。没有自动提交消息、工具或 Agent 执行路径。

自定义连接在同一认证、上下文、取消和去重边界后，由插件服务端调用 /chat/completions，不注册全局模型或改变聊天路由。

## 入口

| 文件 | 职责 |
| --- | --- |
| [package.json](../../../package.json)、[cordis.patch.yml](../../../cordis.patch.yml) | 安装清单、依赖范围、宿主加载和浏览器入口 |
| [src/index.ts](../../../src/index.ts) | 动态设置、公开投影、认证路由、存储、调度、用量 |
| [src/config.ts](../../../src/config.ts) | 包身份、默认值和共享类型 |
| [src/prediction.ts](../../../src/prediction.ts) | 回合折叠、上下文、提示词、宿主模型和输出筛选 |
| [src/custom-model.ts](../../../src/custom-model.ts)、[src/chat-completions.ts](../../../src/chat-completions.ts) | 地址、凭据输入、HTTP、响应与固定错误文案 |
| [src/request-parameters.ts](../../../src/request-parameters.ts) | 类型、保留字段、冲突、兼容读取和大整数无损发送 |
| [src/usage.ts](../../../src/usage.ts) | 参数范围、UTC+8 账本及自填价格估算 |
| [src/client/index.tsx](../../../src/client/index.tsx) | 公开插槽注册、输入状态和样式生命周期 |
| [src/client/settings.tsx](../../../src/client/settings.tsx)、[src/client/custom-model.tsx](../../../src/client/custom-model.tsx) | 设置草稿、带版本保存、连接测试和冲突 |
| [src/client/request-parameters.tsx](../../../src/client/request-parameters.tsx) | 类型参数表单、输出开关和就地校验 |
| [src/client/settings-ui.tsx](../../../src/client/settings-ui.tsx)、[src/client/styles.ts](../../../src/client/styles.ts) | 局部组件、原生弹窗、素材及响应式 |
| [src/client/preview.tsx](../../../src/client/preview.tsx) | 输入框内灰字、接受与隐藏 |
| [src/client/predictions.ts](../../../src/client/predictions.ts) | 页面共享请求、取消、缓存及窗口失效通知 |
| [src/client/status.tsx](../../../src/client/status.tsx)、[src/client/arrow-taps.ts](../../../src/client/arrow-taps.ts) | 只读状态和单／双次右箭头判定 |
| [scripts/build.mjs](../../../scripts/build.mjs)、[scripts/verify-stage1.mjs](../../../scripts/verify-stage1.mjs) | 独立构建、真实官方 Web 安装和验收 |
| [lib/](../../../lib/)、[plugin-build.yml](../../../.github/workflows/plugin-build.yml) | 随仓库分发的预编译安装入口；CI 重建核对产物与源码一致，执行单元测试并打包 |
| [scripts/verify-package.mjs](../../../scripts/verify-package.mjs)、[scripts/check-docs.mjs](../../../scripts/check-docs.mjs) | 运行包一致性和文档本地链接校验 |
| [scripts/automatic-cycle-scenarios.mjs](../../../scripts/automatic-cycle-scenarios.mjs) | 官方输入框连续接受并发送三轮，由本地协议模型回复，验证无固定延迟、每轮一次及下一条自动预测，厂商调用为零 |

模型边界测试在[服务端测试](../../../tests/prediction.test.mjs)，共享客户端状态在[客户端测试](../../../tests/client-predictions.test.mjs)，参数与传输在[参数测试](../../../tests/request-parameters.test.mjs)及[HTTP 测试](../../../tests/chat-completions.test.mjs)。实际入口和证据见[验收说明](../validation/README.md)。
