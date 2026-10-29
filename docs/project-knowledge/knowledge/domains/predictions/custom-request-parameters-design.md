# 自定义生成参数

状态：1.0.0 当前实现。维护角色：插件维护者。最近核验：2026-10-29。

## 输出长度

自定义连接的“限制输出长度”关闭时完全省略 max_tokens，不能用 0、null 或极大值代替。开启时填写大于等于 1 的十进制整数，不接受空白、零、负数、小数或科学计数法；插件不设固定最大值，服务商仍有自己的限制。

数值过小可能因思考消耗而使正文截断；关闭上限不改变 12 秒超时。跟随会话／宿主模型仍使用更多设置中的输出值，自定义模型使用独立设置。

## 参数行

每行保存 key、type、value，支持文本、数字、布尔、JSON。发送为 HTTP 顶层字段，不做厂商预设或点号路径转换。0 和 false 必须保留，JSON 维持嵌套结构；SDK 的 extra_body 不能原样作为 HTTP 包装层发送。

校验空名称、空白或控制字符、重复键、无效数字、布尔与 JSON。model、messages、stream、工具和认证等控制字段不可覆盖；max_tokens 只能使用专用开关，max_completion_tokens 可在关闭该开关后以正整数填写，两者不能并存。类型检查不等于服务商一定支持该字段。

参数验证后再序列化。max_tokens 使用字符串存储并作为数字片段发送，避免 JS Number 舍入或转成 Infinity；数字／布尔／JSON 也在验证后按 JSON 原文发送，文本经 JSON.stringify 转义。不能把未验证值拼入请求或合并至原型链对象。

## 保存与兼容读取

customRequestConfigured、customMaxTokensEnabled、customMaxTokens 和 customParameters 随连接原子保存。customParameters 为参数行的 JSON 字符串，不含 API Key。测试和实际预测共用验证与序列化，修改后测试结果失效。

新连接默认关闭上限。读取已有连接但未设置独立参数时，保留其 outputTokens 值；保存后采用明确的独立设置。此兼容读取不清空数据，也不静默取消用户设置。

保存、测试中禁用编辑，错误就地提示。桌面参数一行排列，手机参数名／删除与类型／值分两行。设计来源为[参数配置](https://www.figma.com/design/VzqhOeUPR1C2j1L1aMbbN1/DSH-predictions?node-id=52-537)。

## 已验证的真实模型示例

GLM-5.3-Flash：关闭 max_tokens，reasoning_effort 类型为文本、值为 low。用户授权的一次真实预测成功，按第二次 → 至灰字出现为 2,227 毫秒，RPC 往返 2,199 毫秒，输入 248、输出 11 Token，正文为“好，你去定位代码并实现吧。”

该[厂商测试报告](../../../../../artifacts/undo/2026-10-29T01-16-17-509Z-dbea5176/report.json)使用的运行实现与首发一致，属于独立厂商补充证据，不是正式包再次实测。Tab、撤销、刷新缓存均未增加调用；凭据已清理。单次结果不代表固定耗时，不据此推断思考已关闭，也不推及其他厂商。

来源：[共享参数](../../../../../src/request-parameters.ts)、[编辑器](../../../../../src/client/request-parameters.tsx)、[参数测试](../../../../../tests/request-parameters.test.mjs)、[真实验收脚本](../../../../../scripts/glm-low-scenario.mjs)。正式包实际入口见[验收](../../../validation/README.md)。
