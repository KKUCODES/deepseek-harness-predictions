# 自定义预测模型

状态：1.0.0 当前实现。维护角色：插件维护者。最近核验：2026-10-29。

自定义连接只影响预测，支持 HTTP(S) 基础地址、API Key、模型 ID、可选输出长度和键值参数。模型名称不加前缀，保存后提供编辑入口。

## 传输边界

仅支持非流式 OpenAI 兼容 Chat Completions，由插件服务端直接调用 /chat/completions，不注册全局模型、不更改聊天路由。地址保留代理路径，拒绝内嵌账号密码、查询、片段或完整接口路径；禁止重定向，避免 Key 被带向其他目标。

请求为 Bearer Key、system/user 文字、stream:false 和明确配置的生成参数。不调用 /models，不尝试 Responses／Messages，不使用 Agent 或工具，不自动重试。12 秒超时、最大 1 MiB 响应，与预测共享在途约束。

只接受 choices 中 index 为 0、正常 stop、没有工具调用的完整 assistant 正文。截断与格式错误不显示灰字，厂商任意错误 message 不回显。HTTP 400／422 提示检查参数；401／403、404、429、网络和格式错误分别提示。智谱已核验业务码区分模型权限、限流、余额、套餐额度及到期，不将其他服务商的同名码套用。

## 凭据与认证

使用宿主公开 ctx.credentials 的 credentialKey、modifyRecord、describeRecord、readRecord，拥有者为 dsh-predictions。普通配置只保存连接、参数和 customCredential 引用，已存 Key 不回传界面或 localStorage。宿主本地凭据服务负责落盘权限，插件不自行声称另有加密。

新 Key 先存为新引用，再与连接字段通过 form.mutate 带版本原子切换。提交失败不替换当前引用；可能保留未引用的暂存凭据，不擅自删除其他记录。

custom/info、custom/key、custom/test 使用 Connection 精确 POST 路由，由宿主执行 Host／Origin、认证与 owner 检查，不自建假认证协议。

## 草稿与保存

测试使用当前填写的连接和参数，不先保存、不启用预测、不携带聊天上下文；发送一次请求，可能收费，并计入插件用量。可取消测试，不重复提交；修改后旧结果失效。填写有效即可保存，不强制先测试。

保存失败保留草稿，冲突时可读取最新设置；离开未保存内容需确认。仅测试通过不能代表真实上下文预测一定成功。

来源：[连接校验](../../../../../src/custom-model.ts)、[HTTP](../../../../../src/chat-completions.ts)、[路由与凭据](../../../../../src/index.ts)、[连接页](../../../../../src/client/custom-model.tsx)、[HTTP 测试](../../../../../tests/chat-completions.test.mjs)。参数见[生成参数](./custom-request-parameters-design.md)，入口验证见[验收](../../../validation/README.md)。
