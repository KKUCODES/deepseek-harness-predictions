# 预测消息插件工作入口

遵守根目录 [AGENT.md](../AGENT.md)。开工先读取 [README.md](./README.md)、[知识库总目录](./docs/project-knowledge/catalog.md)与相关业务文档，完成后同步实际规则和验证结果。

- 项目是独立的 Harness 插件。严格不修改宿主源码、安装文件、私有编辑器或其他项目；只使用已有公开扩展接口。所有依赖、脚本、参考副本及测试产物都放在本项目。
- 预测默认关闭，效果测试与真实预测互斥。效果测试不调用模型；真实预测不自动发送聊天或启动 Agent。使用已有会话时，通过公开投影恢复回合身份，不改写会话日志或使用实验包专属 appendPluginRecord。
- 自定义模型仅支持非流式 OpenAI 兼容 Chat Completions。Key 由宿主公开 credentials 服务管理，不进入普通配置、报告、页面附件或模型名称；模型名称不加前缀。[连接边界](./docs/project-knowledge/knowledge/domains/predictions/custom-model.md)包含原子保存和认证规则。
- 自定义 max_tokens 关闭时必须省略，开启只要求正整数，不设插件固定最大值。键值参数保留数字、布尔及 JSON 类型，禁止覆盖模型、消息、流式、工具与认证字段。测试和实际预测共用参数校验与序列化。[参数规则](./docs/project-knowledge/knowledge/domains/predictions/custom-request-parameters-design.md)说明兼容读取行为。
- 不提供每日次数、Token、金额上限、额度预占、官方定价或刷新已有建议。用量只作记录，自填价格只作估算；缓存、接受和撤销不能新增调用。
- 真实厂商验证须获得明确授权并显式选择。--bigmodel-real-key-file 只做连接草稿验收；--bigmodel-prediction-key-file 验证真实手动／自动预测，隔离模型配置关闭标题模型和适配器重试；--glm-low-key-file 仅触发一次 low 真实预测，不做连接测试或主聊天。不因 429 或失败自动换模型、端点、参数或重发。
- 普通回归不读取厂商 Key。验收创建独立 home，不改变日常 profile；结束后清理本次凭据，按 ChildProcess 句柄停止测试进程并核对端口，记录宿主文件摘要。
- 交付前验证真实使用入口。组件、模拟宿主或本地协议测试不能冒充官方 Web、真实厂商或 Electron 验收；组合输入事件不等同于系统输入法候选词窗口。限制见[兼容性](./docs/project-knowledge/knowledge/domains/predictions/stability.md)。
