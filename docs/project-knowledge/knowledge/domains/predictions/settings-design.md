# 设置页设计规范

状态：1.0.0 已采用。维护角色：插件维护者。最近核验：2026-10-29。

设计语言为极简、自解释。主页面只保留常用操作，高级字段和只读明细按需打开，不改宿主导航或弹窗服务。

## 基础与组件

[基础规范](https://www.figma.com/design/VzqhOeUPR1C2j1L1aMbbN1/DSH-predictions?node-id=4-65)定义颜色、字体、字号、间距、圆角与图标；[组件与状态](https://www.figma.com/design/VzqhOeUPR1C2j1L1aMbbN1/DSH-predictions?node-id=6-234)定义按钮、输入、开关、导航、提示和弹窗。

运行版继承宿主字体，内容最大宽度 640px，分组间距 24px，输入高 40px，按钮高 36px，圆角 8px。复用本地 SVG，不以手绘 CSS 替代已有设计资产，不依赖临时下载地址。

按钮与输入保留默认、悬停、焦点、禁用和错误状态；请求与保存显示忙碌反馈。初始加载、无统计、读取失败、连接测试失败、保存失败和冲突分别呈现，不以空白替代错误。

## 页面规则

[主设置页](https://www.figma.com/design/VzqhOeUPR1C2j1L1aMbbN1/DSH-predictions?node-id=7-149)以启用、生成方式、预测模型、今日用量和更多设置组织内容。不展示每日额度、官方定价或刷新操作。

保存栏仅有保存按钮：无有效修改置灰，有有效修改可点击；不显示左侧“已保存”或“有未保存的更改”。保存中、校验、错误和冲突仍须明确反馈。桌面靠右，窄屏使用整行按钮。

[自定义参数页](https://www.figma.com/design/VzqhOeUPR1C2j1L1aMbbN1/DSH-predictions?node-id=52-537)按连接、输出开关、参数、测试和保存排列。桌面参数一行，手机参数名和删除在第一行，类型和值在第二行；自定义连接使用中的更多页不重复显示输出长度。

布局同时适配窄屏和深色，原生 dialog 管理焦点、Esc 和焦点归还。原型仅说明页面关系，不能替代运行验收。

来源：[组件](../../../../../src/client/settings-ui.tsx)、[局部样式](../../../../../src/client/styles.ts)、[设置](../../../../../src/client/settings.tsx)、[参数表单](../../../../../src/client/request-parameters.tsx)。
