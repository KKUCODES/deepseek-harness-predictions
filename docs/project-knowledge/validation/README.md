# 运行验收

状态：1.0.0 首发包主流程已通过，源码与预编译产物已公开推送，GitHub 安装与 CI 已验证；尚未创建 Release。维护角色：插件维护者。最近核验：2026-10-29。

## README 文档重排（2026-10-29）

中英文首页按产品介绍、效果占位、兼容表、本地安装、键位、模型与费用隐私组织。当前仓库没有远端地址，保留公开下载待发布状态，不编造 npm/GitHub 分发入口；CLI 本地包命令沿用现有验收脚本的 `plugin --profile web add`。截图与动图仅为文字占位，没有生成虚假界面。

`npm run check:docs`通过23篇文档、164个本地文件链接；`npm pack --dry-run --json --ignore-scripts`确认39个包条目包含README.md、README.en.md与docs/README.md，预检结果位于`artifacts/readme-package-dry-run.json`。本轮未修改运行代码、依赖或安装元数据，未运行模型、修改DSH环境、重新生成正式tgz、提交或发布；不把文档检查当作新的运行验收。

## README 双语动图接入（2026-10-29）

用户提供的`cn.gif`、`en.gif`原样复制到`docs/images/predictions-cn.gif`与`predictions-en.gif`，分别替换中英文首页的动图占位，两个截图位保留。副本与下载目录原件的SHA-256逐一一致，未编辑动画或删除原件。文档检查通过23篇、170处本地链接；GIF文件头、语言对应和截图占位核对通过。

本次保持插件打包配置不变，`npm pack --dry-run`的39个条目不包含GIF；动图用于源码仓库文档展示，不增加插件安装包体积。预检记录为`artifacts/readme-gif-package-dry-run.json`。未重新生成正式包、操作宿主、提交或发布。

## GitHub 预编译分发配置（2026-10-29）

已创建公开仓库 `KKUCODES/deepseek-harness-predictions`，本地中英文 README 改为 `dsh plugin --profile web add github:KKUCODES/deepseek-harness-predictions`。对照 DSHM 电脑插件的预编译分发方式，`lib/` 不再忽略，源码与构建产物需要一同提交；不添加安装生命周期脚本。[构建工作流](../../../.github/workflows/plugin-build.yml)重新构建并检查 Git 差异和遗漏的新增产物，运行单元测试并上传安装包，不自动创建 Release。[开发说明](../../development.md#github-安装分发)记录发布要求。

本地构建通过，连续两次构建的 33 个产物逐文件 SHA-256 一致；65 项单元测试通过，文档检查通过 23 篇、176 个本地链接。`npm pack --dry-run --json --ignore-scripts` 的 39 个条目包含前后端入口、类型声明、补丁与双语 README，不包含源码或测试产物。官方安装规格解析器接受上述地址为 Git 类型，安装元数据无本地运行依赖或安装时构建钩子。

本轮未提交、推送、运行线上 Actions 或公开 GitHub 安装。以上是本地分发准备检查，不代表公开 GitHub 命令的下载、安装与加载已经实测；首次推送后需要在隔离 Web profile 补验。

## 公开仓库上传与安装验证（2026-10-29）

首个公开提交为 `43cce43513e4594c146e99fb2c688ec33ec97dd7`，目标为 `KKUCODES/deepseek-harness-predictions` 的 `main`。[首次 Actions](https://github.com/KKUCODES/deepseek-harness-predictions/actions/runs/40845696825)全部通过，包括干净环境安装依赖、Linux 重建核对、65 项单元测试与安装包上传。

本地使用官方 DSH `0.2.1-rc.3` CLI，在项目 `artifacts/github-install/run-mY9QkK/home` 隔离 profile 实际执行 `plugin --profile web add github:KKUCODES/deepseek-harness-predictions`，成功安装 `1.0.0`，核对前后端入口、服务端声明与补丁文件存在。报告保存在该运行目录的 `report.json`，安装日志为 `install.log`；均不随仓库提交。未使用日常 DSH_HOME、厂商 Key 或模型请求。该项验证公开仓库下载与安装入口，不冒充重新完成全部浏览器 UI 和模型验收。

## 官方 Web 复现入口

在项目目录执行 npm run build、npm run typecheck、npm run test:unit、npm run check:docs。官方 Web 使用 npm run verify:stage1、npm run verify:settings、npm run verify:status、npm run verify:parameters 和 npm run verify:stage4。

默认使用项目内官方 Harness CLI 与本机 Edge；--sdk-root .runtime/stable-sdk 可选择另一份项目内官方安装，--browser chrome 可选择 Chrome。参数以[验收脚本](../../../scripts/verify-stage1.mjs)为准。

脚本通过 npm pack 生成实际包，由官方 CLI 安装到新的 DSH_HOME，在真实认证、设置页和原输入框验证；不构建或修改宿主，不使用日常 profile。

参数、状态和缓存回归需要 artifacts 中的真实会话样本。--cached-model-from 只接受本项目 artifacts/stage2 下已完成且 Host 停止的真实报告，复制会话、投影和工作区身份，不复制凭据或伪造日志。缺少样本不能把局部检查称为全量通过。

## 正式包证据

[连续三轮自动预测报告](../../../artifacts/undo/2026-10-29T04-03-57-840Z-38e8d148/report.json)使用官方 rc.3 / Edge 的实际包与原输入框，依次接受预测、发送、由官方模型适配器读取本地 SSE 回复，再直接触发下一条。共 3 次主聊天、3 次预测、0 次手动触发、0 次厂商调用；每轮都直接返回 ready，无跨轮间隔等待，设置页不包含触发等待或自动调用间隔。宿主文件摘要不变，进程与端口已停止。65 项单元测试覆盖立即触发、已有时间配置不生效、每轮一次、取消、不自动重发和会话初始化先后次序。该流程不把本地协议结果描述为厂商模型实测。

连续直接触发流程在官方 rc.2 / Chrome 的[报告](../../../artifacts/undo/2026-10-29T04-00-49-993Z-db167546/report.json)通过；状态、取消、超时、缓存及卸载的[回归报告](../../../artifacts/undo/2026-10-29T04-03-57-838Z-2c6c4d1d/report.json)通过，均为零厂商调用。[完整设置与缓存恢复](../../../artifacts/undo/2026-10-29T04-03-08-401Z-f0e367db/report.json)覆盖已有会话尚在加载的情形、保存重试、多窗口冲突和自定义模型。

[1.0.0 独立主流程报告](../../../artifacts/undo/2026-10-29T01-48-22-264Z-7c60f7f5/report.json)使用官方 rc.3 / Edge，通过以下入口：

| 入口 | 结果 |
| --- | --- |
| 独立 tgz 安装、加载和未认证拒绝 | 通过 |
| 输出开关省略字段、整数、大整数和四种类型 | 通过 |
| 重复键、保留字段、SDK 包装和输出限制冲突 | 通过 |
| 连接测试、测试失效、统一保存和重载 | 通过 |
| 原输入框自动与双次右箭头手动预测 | 通过 |
| Tab、Ctrl+Z、输入清空和刷新缓存无额外请求 | 通过 |
| 1280／768／390 布局、模型无前缀和无重复输出项 | 通过 |
| 关闭和官方 UI 卸载恢复原输入框 | 通过 |

共 7 次本地协议请求，厂商调用 0 次，未新增主聊天步骤；宿主文件综合摘要不变，Host 和监听均停止。[包核对](../../../artifacts/package-verification-1.0.0.json)确认运行文件与安装元数据和正式包实际验收一致。只更新打包文档可以核对运行文件，不能替换运行行为后沿用报告。

## 补充覆盖

以下记录核对相同运行实现的具体边界，保留原报告身份，不将其说成正式包重新实测。

| 范围 | 证据 |
| --- | --- |
| rc.2 / Chrome 参数主流程 | [记录](../../../artifacts/undo/2026-10-28T17-49-02-484Z-5ff02364/report.json) |
| 状态、失败、超时、取消、缓存和减少动态效果 | [记录](../../../artifacts/undo/2026-10-28T17-48-52-360Z-ecafbb10/report.json) |
| 设置、网络失败重试与多窗口冲突 | [记录](../../../artifacts/undo/2026-10-28T17-49-37-399Z-8b22a604/report.json) |
| GLM-5.3-Flash 真实单次 low 预测 | [记录](../../../artifacts/undo/2026-10-29T01-16-17-509Z-dbea5176/report.json) |

GLM 仅一次收费预测，省略 max_tokens，reasoning_effort 为 low；按键至灰字 2.227 秒，输入 248、输出 11 Token。接受／撤销／刷新不增加调用，测试凭据已清理。单次结果不是固定延迟或所有厂商兼容证明。

## 付费与审计边界

--real-model、--manual-real、--bigmodel-real-key-file、--bigmodel-prediction-key-file、--glm-low-key-file 均须显式选择并获得授权，普通回归不读取厂商 Key。连接测试不能代替真实预测验收，不能因失败自动追加调用。

核对正常正文、灰字、用量和缓存，不只核对 HTTP 200。失败报告不计作通过。原始产物留在 artifacts，日期、包身份和失败事实不改写；缺少报告时说明不可复现的原因。

Electron、真实系统输入法、工具／Agent 完整运行流程和其他限制见[兼容性](../knowledge/domains/predictions/stability.md)。
