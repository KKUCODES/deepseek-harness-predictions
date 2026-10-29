# 预测消息

适用于 1.0.0。本业务域负责输入框内预测、键盘接受、模型配置、请求调度和用量。

| 文档 | 读取时机 |
| --- | --- |
| [业务规则](./business-rules.md) | 核对触发、输入保护和功能边界 |
| [设置与只读用量](./settings-usage.md) | 修改设置、保存、统计和估算 |
| [设计规范](./settings-design.md) | 核对布局、组件与保存栏 |
| [预测状态](./prediction-status-design.md) | 修改圆圈、加载及悬停说明 |
| [自定义模型](./custom-model.md) | 修改连接、认证、凭据与 HTTP |
| [生成参数](./custom-request-parameters-design.md) | 修改 max_tokens、类型、冲突和序列化 |
| [模型调用](./real-predictions.md) | 修改提示词、上下文、调度及持久去重 |
| [接受与缓存](./undo-cache.md) | 修改 Tab、撤销、清空、刷新与 Esc |
| [手动预测](./manual-refresh.md) | 修改双次右箭头与已有聊天入口 |
| [兼容性与稳定性](./stability.md) | 核对实际覆盖和未验证场景 |
| [接入与验收注意事项](./pitfalls.md) | 排查设置、日志、生命周期和撤销 |
| [模块地图](../../../blueprint/module-map.md) | 查找代码入口 |
| [运行验收](../../../validation/README.md) | 复现验证和解释证据 |
