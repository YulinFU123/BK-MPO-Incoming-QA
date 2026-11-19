# 双图功能与UI逐项核对

**历史记录：本报告针对0.11.0-dev.1；源码链接已固定到该版本随包源码。当前0.12代码修复和未放行项见[发布核验](D:/项目/BK_MPO来料异常跟进/资料/审计与方案/智能工作台升级/发布核验与正式放行条件.md)。**

核对日期：2026-10-30（中国时间）。对象：唯一版本索引中的0.11.0-dev.1，完整离线候选SHA-256 `d6a0ba696c971cf4022ef8fd5473b8127157df9c3d0acb6a2587119dfb89fc57`。

结论：当前是接近参考结构的开发候选，不能说两张图已完整实现。除布局/控件差距外，发现环图接口错误、两份分析范围不一致、排序刷新和统计刷新等问题。之前280项代码测试与22项独立包检查没有覆盖这些界面联动，不能用于抵消这些发现。

本轮完成两张原图复阅、79项功能/组件源码映射、10项缺陷整理、隔离合成数据复核、31个原路由入口盘点，以及246个候选源码文件逐项哈希比对。没有修改程序源码、候选包、版本号或正式数据。

**验证边界：本轮没有实际浏览器/Windows界面截图和逐控件点击验收。此前GPT内置浏览器来源权限明确拒绝127.0.0.1:2996，本轮没有重复申请或改用其他方式绕过。下表“代码已有”不等于UI已验收；像素距离、弹出菜单样貌、遮挡、焦点和DPI实际效果仍待验证。**

## 两张参考图

图A为固定导航、真实多工作区标签、分析筛选与右侧设置的主分析页。图B为卡片管理＋右侧分析预览的工作区管理页。图A顶部彩色注释是设计说明，不应做成软件里的装饰框。

![图A：主分析页](D:/项目/BK_MPO来料异常跟进/构建/当前作业/资料/用户首页布局参考.png)

![图B：工作区管理页](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/资料/工作区管理参考.png)

## 优先缺陷

|编号|优先级|问题及验证层级|证据和修复验收|
|---|---|---|---|
|B01|P0|**环形图接口用错**；源码确定。G.donut签名是(items,total,onSelect)，管理页传(items,{onSelect})。数字total收到对象，格式化/除法产生NaN，onSelect未提供。尚未在真实窗口复现。|改为统一参数约定；覆盖0条、1类、多类、百分比总和及分类点击。 [W-DONUT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:569)、[G-DONUT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-graphics.js:178)|
|B02|P1|**同工作区两页分析范围未衔接**；隔离数据层复现。合成工作区管理偏好近7天得到2条，而主分析模块仍读默认近30天得到3条。并非数据丢失，是两份配置未同步。|打开时继承当前预览范围，或明确选择并标注独立分析方案；保留模块各自记忆，避免静默切成另一范围。 [STORE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/managed-workspace-host.js:108)、[H-STATE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/domain/home-workspaces.js:19)、[BRIDGE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/renderer.js:42)|
|B03|P1|**排序箭头与数据可能不一致**；源码+数据层复核。表头点击传sn升序，日期/周期等刷新调用省略sort，后端回退date降序；全页sort变量仍保留。合成请求分别返回B002,C003及C003,B002。|所有请求使用统一已应用查询对象，刷新后仍按箭头排序；按工作区记忆。 [W-TABLE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:609)、[W-ANALYSIS](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:458)、[REPORT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/domain/home-report.js:16)|
|B04|P1|**左卡与右报告不同步且周期不明**；源码+数据层复核。改范围时patch保留旧summary，右侧重取report，卡片不更新；相同合成数据近7天2条、全部3条，卡片没有周期标注。|更新受影响卡片统计、显示周期，或把卡片明确设为独立总览范围。 [W-PATCH](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:144)、[W-CARD](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:287)、[STORE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/managed-workspace-host.js:108)|
|B05|P1|**工作区重命名后活动标题仍旧**；隔离数据层复现。目录已改为“已改名的合成工作区”，controller.status().workspaceName仍为旧名。|重命名广播到活动会话、标题、标签和相关导出名。 [RENAME](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/managed-workspace-host.js:211)、[CONTROLLER](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/workspace-controller.js:146)|
|B06|P1|**页面切换更换整套导航**；源码确定。只有home附加workbench-home；该类下隐藏primaryNavigation并显示hs-nav。切换业务页又恢复另一套导航。|一个稳定导航组件贯穿业务页，不因路由切换更换结构。 [H-NAV](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:238)、[RENDERER](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/renderer.js:571)|
|B07|P2|**备份成功提示用错误样式**；源码确定。成功分支调用safeError，写入红色wm-message、role=alert。|成功、警告和失败独立反馈。 [W-OTHER](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:792)、[W-WORK](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:61)|
|B08|P2|**深色图形文字颜色未随主题切换**；源码确定/视觉待验。manager在自身固定--hs-text/#142c48和--hs-muted/#647b98；深色仅覆盖wm变量。图形fill引用hs变量。|统一主题令牌并截图测可读性。 [W-DARK](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.css:822)、[W-CSS](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.css:5)、[G-DONUT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-graphics.js:178)|
|B09|P2|**忙时控件可点但操作被忽略**；源码确定。work在loading或working时直接return；部分select可先改变外观值，却不提交请求。|忙时禁用或排队，保持显示值等于已应用值。 [W-WORK](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:61)|
|B10|P2|**卡片/详情收藏星标刷新不同步**；源码确定。卡片收藏仅更新item并renderCards，没有renderDetail，右侧标题星标可保持旧状态。|收藏后所有引用同一工作区的组件一起刷新。 [W-CARD](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:287)、[W-DETAIL](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:397)|

隔离复核使用3条明确合成记录（10月1日、27日、29日）和公开测试加密器，只在本轮验证目录生成测试文件，没有读取或解密公司记录。本轮数据层复核不代表Windows账户提供器、可见UI或公司环境验收。脚本正常退出仅表示核对完成，不表示软件无缺陷。

## 图A：主分析页

|编号|参考要求|状态|当前实际实现及差距|建议验收与源码|
|---|---|---|---|---|
|A01|固定分组导航|部分|首页有四组导航；离开首页切回另一套主导航，未形成图中稳定的全模块导航。|同一菜单组件贯穿各页面，切换不跳结构。 [H-NAV](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:238)、[RENDERER](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/renderer.js:571)|
|A02|导航手动折叠与记忆|代码已有|存在全局折叠/宽度记忆，首页分组展开单独记忆；未实际点击验收。|折叠、重启恢复及分组状态逐项验证。 [H-NAV](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:238)、[RENDERER](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/renderer.js:571)|
|A03|导航自定义排序/隐藏|缺少|首页分组/项目由固定数组生成，没有图中所述自定义排序和隐藏界面。|可排序、隐藏、恢复默认并可靠保存。 [H-NAV](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:238)|
|A04|顶部真实工作区标签|部分|现有标签是同一个eap中的分析视图，切换真实工作区仍通过管理页锁定/重开。|顶部标签绑定真实工作区ID，切换不混数据。 [H-TABS](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:351)、[OPEN](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/managed-workspace-host.js:243)|
|A05|标签关闭/重开|部分|分析视图可关闭重开；没有图中真实工作区标签及关闭标签与删除数据的统一语义。|关闭标签不删工作区，草稿可恢复。 [H-TABS](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:351)、[H-STATE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/domain/home-workspaces.js:19)|
|A06|标签待保存提示和右键菜单|缺少|无每标签草稿/保存标记，无标签右键菜单。|每工作区保存状态可见，关闭/复制等菜单真实可用。 [H-TABS](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:351)|
|A07|顶部全局搜索|部分|搜索当前分析视图的SN、异常和跟进字段；不搜索全部工作区，未映射工单号。|明确搜索范围；若全局则跨工作区去重查询。 [H-TOP](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:204)、[REPORT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/domain/home-report.js:16)|
|A08|顶部新建/扫码快捷操作|代码已有|新建记录、批量扫码及待办入口保留，尚未实机点击验证。|三入口能进入对应模块且保留当前工作区。 [H-TOP](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:204)|
|A09|通知铃铛及真实未读数|部分|原BI预警等入口存在，首页没有图中的通知聚合与真实未读数。|接入实际预警；不显示虚构红点和数量。 [H-NAV](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:238)、[H-TOP](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:204)|
|A10|主题和账户区|部分|主题在侧栏，未按图置于顶栏；没有图中管理员账号体系。|提供主题入口；无账户系统时展示本机状态即可。 [H-TOP](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:204)|
|A11|常用操作按钮自定义|缺少|首页按钮顺序和集合写死，旧页有各自上下文操作。|工作区可配置常用操作并记住顺序。 [H-TOP](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:204)|
|A12|时间起止及快捷范围|部分|有起止、7/30/90天和全部；缺今天、本月、上月等参考图入口。|统一今天/近7/近30/本月/上月/自定义。 [H-FILTER](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:452)、[H-STATE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/domain/home-workspaces.js:19)|
|A13|工序/异常/责任人/报检人/班次组合筛选|部分|提供工序、异常、跟进负责人、报检人、报检班别的单值筛选；责任人和生产班次不等同跟进字段。|独立业务字段、准确别名、明确多选语义。 [H-FILTER](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:452)、[REPORT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/domain/home-report.js:16)|
|A14|筛选影响所有图表和表格|部分|单分析视图内部联动已有；工作区管理预览与打开后的分析页使用两套偏好，合成核对已复现范围不一致。|同一工作区只有一份已应用的查询范围。 [STORE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/managed-workspace-host.js:108)、[H-STATE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/domain/home-workspaces.js:19)、[BRIDGE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/renderer.js:42)|
|A15|查询与重置|部分|查询/字段重置存在；重置不恢复日期、数据集和排序，语义与图中全范围重置不一致。|区分清空字段与重置全部条件。 [H-FILTER](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:452)|
|A16|五项核心指标|部分|条数、件数、不良率、未关闭、超期都有；仅条数有前期变化摘要，缺每项同比/环比和小箭头。|比较周期可选，有效指标均给数值、差额与依据。 [H-METRIC](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:726)|
|A17|趋势柱线与数据点|代码已有|支持柱线、点值、横线、双轴及下钻；实际显示未验证，较多日点会横向滚动。|看清每点数值/单位/周期，验证长范围与小窗口。 [G-COMBO](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-graphics.js:50)、[H-METRIC](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:726)|
|A18|按日/周/月趋势|代码已有|周期选择及汇总实现。|边界日、跨月和前期对齐核对。 [H-METRIC](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:726)、[REPORT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/domain/home-report.js:16)|
|A19|图表图片导出/放大|缺少|首页没有每图下载/放大按钮；当前总导出仅当前明细CSV，旧分析Excel入口另存。|当前图可放大、导图，导出保留筛选与口径。 [H-EXPORT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:1092)、[H-METRIC](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:726)|
|A20|分类环图按条数/件数切换|部分|主分析环图按异常条数；没有图中数量口径切换。管理页还存在接口错误，见B01。|正确传参，并用真实数量数据支持口径选择。 [G-DONUT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-graphics.js:178)、[H-METRIC](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:726)、[W-DONUT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:569)|
|A21|环图引线数据标签|部分|图例有名称、条数、百分比；没有图中环外引线标签。|外部标签避让，至少名称/数值/占比清楚。 [G-DONUT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-graphics.js:178)|
|A22|工序排名与占比|部分|条形给条数，未显示图中每行占比；没有按条数/件数选择。|条形、精确值、占比和统计口径同时明确。 [G-RANK](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-graphics.js:228)|
|A23|异常明细表字段|部分|9个业务/跟进列及查看操作已实现；缺异常业务编号、工单号、独立责任人、不良件数、真实发生时刻。|先补数据模型/映射，不能用SN或创建时间冒充。 [H-TABLE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:868)、[REPORT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/domain/home-report.js:16)|
|A24|排序、分页与状态标签|部分|主分析表可排序、有彩色状态和前后页；无页码跳转/每页条数。管理预览排序有刷新缺陷。|所有展示列真实排序；分页清楚；刷新不丢规则。 [H-TABLE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:868)、[W-TABLE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:609)|
|A25|负责人Top10|部分|当前是跟进负责人关联条数Top10，不是图中的生产责任人或不良件数。|新增明确责任人来源，不直接重命名现有维度。 [H-METRIC](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:726)、[REPORT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/domain/home-report.js:16)|
|A26|环比分析图|部分|已有本期/同长上期条数柱形，无图中的环比百分比折线及对比方式选择。|给出上期、本期、百分比与零分母处理。 [H-METRIC](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:726)|
|A27|发生时段分析|缺少|用报检班别条形替代，尚无真实发生时刻的时间段分布。|增加发生时间/时区及分段规则，不拿保存时间代替。 [H-METRIC](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:726)、[REPORT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/domain/home-report.js:16)|
|A28|右侧设置三标签|部分|只有工作区、分析设置两页，模板字段为跳转旧页，不是图中内嵌第三页。|基本、分析、模板字段语义一致且只影响当前工作区。 [H-SET](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:569)|
|A29|分析维度/指标/类型/对比设置|缺少|只有数据集、密度和图表显隐，没有图中的分组维度、显示指标、图表类型和对比方式控件。|所有选择真实改变查询和图形，并独立保存。 [H-SET](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:569)|
|A30|自由图表布局|部分|可显隐及恢复固定布局，不能拖动、改变顺序/大小或添加任意图表。|布局配置版本化，拖动/缩放/恢复可验证。 [H-SET](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:569)、[H-CSS](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.css:551)|
|A31|统一数据口径和来源说明|代码已有|显示检验分母与来源，禁止条数伪装件数；原BI与eap仍各自统计，未统一自动汇总。|在保留来源边界前提下逐步支持明确关联。 [H-SET](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:569)、[REPORT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/domain/home-report.js:16)|

## 图B：工作区管理页

|编号|参考要求|状态|当前实际实现及差距|建议验收与源码|
|---|---|---|---|---|
|C01|启动免文件/免密码|代码已有|直接进入管理页，新建元数据自动落本机目录；旧密码文件入口保留。|首次与重启都无强制业务文件/密码步骤。 [W-ROOT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:151)、[OPEN](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/managed-workspace-host.js:243)|
|C02|真正独立数据工作区|代码已有|各工作区独立eap、模板和分析配置，代码与历史专项已有验证。|新增/切换/重启不串记录。 [STORE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/managed-workspace-host.js:108)、[OPEN](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/managed-workspace-host.js:243)|
|C03|左卡片右详情分栏|部分|双栏已实现；默认1380窗口触发2列卡片，图中为3列；右侧环图布局也不同。|在明确基准视口匹配参考图，再验证响应式。 [W-CSS](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.css:5)、[W-RESP](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.css:742)、[WINDOW](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/main.js:156)|
|C04|搜索、排序、卡片/列表|代码已有|名称/工序/描述搜索、三种排序、两种视图已有；列表还不是参考风格的完整表格。|各视图字段对齐，排序及重启记忆可核对。 [W-ROOT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:151)|
|C05|卡片图标、收藏、更多菜单|部分|色块内是工序首字，不是图中的剪刀/包装等SVG；有收藏，无卡片更多菜单。|统一SVG与更多菜单，将重命名/复制/归档收纳。 [W-MARK](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:282)、[W-CARD](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:287)|
|C06|创建时间和最近使用|部分|卡片均有；右侧标题少最近使用时间，收藏星标刷新也未与卡片统一。|两处信息一致，无旧名称/旧星标残留。 [W-CARD](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:287)、[W-DETAIL](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:397)|
|C07|卡片四指标|部分|四项已具备，但按每卡已存日期范围统计，卡片没标范围，比较有歧义。|显示周期或统一总览周期，不隐藏不同口径。 [W-CARD](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:287)、[STORE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/managed-workspace-host.js:108)|
|C08|卡片趋势曲线|部分|有折线/点和悬停title，没有图中的面积填充、周期标注及点值常显。|周期明确，选中/悬停能立即对应数值。 [W-CARD](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:287)|
|C09|卡片与右侧实时一致|缺陷|改日期后只更新右侧报告，卡片summary沿用上次managedList；刷新详情也不重取卡片统计。|筛选后卡片及详情同时更新或明确不同范围。 [W-PATCH](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:144)、[W-ANALYSIS](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:458)|
|C10|顶栏分裂式新建菜单|部分|顶栏是普通按钮；三种创建方式放在新建卡片里，入口位置不同。|新建按钮提供空白/模板/复制的明确入口。 [W-ROOT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:151)、[W-CREATE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:822)|
|C11|空白/模板/复制创建|部分|三入口存在，但模板来源只能选已有工作区，并非独立模板库；复制范围有限。|清楚说明复制范围，支持独立模板选择。 [W-CREATE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:822)|
|C12|复制不复制正式数据|代码已有|复制完整记录模板及分析偏好，不复制记录/草稿；二维码和BI独立模块记忆未复制。|选项明确，有复制范围摘要。 [STORE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/managed-workspace-host.js:108)|
|C13|右侧关闭按钮|缺少|当前只有打开按钮，没有图中的关闭详情X。|关闭只收起详情，不关闭/删除工作区。 [W-DETAIL](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:397)|
|C14|右侧六类设置|部分|六标签都有；字段、完整默认值和扫码规则主要跳旧页面，不是就地编辑。|能内嵌编辑或跳转后准确返回当前上下文。 [W-DETAIL](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:397)、[W-FIELDS](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:704)、[W-SCAN](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:780)|
|C15|日期输入与快捷范围|部分|有起止、7/30/90天/全部；缺今天/本月/上月。|与主分析页共用同一个范围控件和状态。 [W-ANALYSIS](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:458)|
|C16|四项核心指标及前期比较|部分|指标齐全但只有条数差额；其他项无图中前期数、百分比、涨跌箭头，指标也不可点击看明细。|每项有真实比较，点击能追溯来源。 [W-ANALYSIS](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:458)|
|C17|右侧柱线图|部分|共享主图组件，有数值和网格；没有每图粒度框/放大/导出，件数点点击未传处理函数。|点、柱均可查看对应事实，不留无反馈操作。 [W-ANALYSIS](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:458)、[G-COMBO](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-graphics.js:50)|
|C18|右侧分类环图|缺陷|调用签名错误：把options对象传到了数字total的位置，百分比和中心值无效，点击回调缺失。|修复接口约束，覆盖空值/非空值/点击用例。 [W-DONUT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:569)、[G-DONUT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-graphics.js:178)|
|C19|工序/负责人Top5|部分|跟进人按条数排名，有数值但没占比，也无数量口径切换。|姓名语义准确，数字/占比/口径统一。 [G-RANK](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-graphics.js:228)、[W-ANALYSIS](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:458)|
|C20|最近记录表|部分|有6列、表头排序，无更多/单行详情/分页；无独立异常编号/工单号/件数。|最近记录可跳完整查询，可查看具体记录。 [W-TABLE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:609)|
|C21|状态彩色胶囊|缺少|状态文字全部用同一种棕色，未按待处理/处理中/待验证/已关闭区分；与主分析表不一致。|复用同一StatusTag组件及颜色字典。 [W-TABLE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:609)、[W-CSS](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.css:5)、[H-TABLE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:868)|
|C22|工作区重命名|部分|目录能改名，但已打开控制器仍保留旧名字，合成检查已复现。|卡片、标题、顶栏和导出名同步更新。 [RENAME](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/managed-workspace-host.js:211)、[CONTROLLER](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/workspace-controller.js:146)|
|C23|基本信息/颜色修改|代码已有|名称、工序、描述和颜色可改；修改保存状态反馈较弱。|即时校验、成功状态、失败可重试。 [W-DETAIL](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:397)|
|C24|归档、备份及恢复|代码已有|归档不删，bkw本机备份恢复保留；不等于跨电脑迁移。|继续标明账户/程序配置要求和恢复范围。 [W-OTHER](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:792)|
|C25|页面状态和表格排序记忆|部分|卡片模式/选择/目录排序持久；最近表排序是全页会话变量，未按工作区隔离，刷新还会丢请求。|明确临时与长期配置，排序按工作区保存。 [W-ROOT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:151)、[W-TABLE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:609)|
|C26|新建、切换和保存反馈|部分|有aria-busy和错误文字；忙时点击会被直接忽略，备份成功复用错误样式。|忙时禁用/排队并说明；成功与失败分开。 [W-WORK](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:61)、[W-OTHER](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:792)|

## 共用UI组件逐项核对

|编号|组件|状态|当前实际实现及差距|建议验收与源码|
|---|---|---|---|---|
|U01|全局布局比例|部分|管理页分栏、主分析三栏都有；未按同一视口进行过截图叠对。|1536×1024、1440×900、1280×800各验收。 [W-RESP](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.css:742)、[H-CSS](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.css:551)|
|U02|字体与文字清晰度|部分|管理页表格/辅助数据有大量10px字号，字重和主分析页不统一。|正常缩放可读，无挤压/截断；截图复核。 [W-CSS](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.css:5)|
|U03|Logo与模块图标|部分|主Logo是六边形立体图，不是参考图A形；工作区使用文字色块/Unicode符号。|统一可缩放SVG图标、尺寸、线宽与对齐。 [W-MARK](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:282)、[H-TOP](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:204)|
|U04|主按钮和次按钮|部分|hs-button、wm-button及原模块button各自定义，圆角/高度/间距不一。|复用按钮令牌及四态，避免每页自行配色。 [W-CSS](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.css:5)、[H-CSS](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.css:551)|
|U05|输入/搜索框|部分|各页已有标签和焦点；高度、内边距、清空/帮助图标仍分散。|共用Field/SearchField并逐状态检查。 [FIELD](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/field-controls.js:21)、[W-ROOT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:151)|
|U06|单选下拉菜单|部分|新页仍使用原生select；SelectionControls只增强datalist，并未接管select弹出层。|统一自定义列表样式和键盘操作，实际展开检查。 [SELECT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/selection-controls.js:176)、[H-SET](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:569)、[W-DEFAULT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:724)|
|U07|多选与可搜索选项|缺少|这些新页面没有多选筛选和统一可搜索下拉；旧可输入候选另有实现。|单选/多选/可输入明确区分，统一空项和长文本。 [SELECT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/selection-controls.js:176)、[H-FILTER](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:452)|
|U08|日期弹出面板|部分|原生date输入有功能，但弹出日历没有与参考图统一。|确定日期控件方案，验证中文、范围、焦点及缩放。 [W-ANALYSIS](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:458)、[H-FILTER](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:452)|
|U09|复选框和分段按钮|部分|主分析图表显隐存在；管理页没有同类配置面板，尺寸和选中形态未统一。|复用Check/Segment组件及禁用态。 [H-SET](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:569)、[W-DETAIL](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:397)|
|U10|标签栏与键盘焦点|部分|有tab角色，没有完整左右方向键/焦点轮转逻辑；关闭小按钮部分无明确名称。|Tab、左右、Home/End及关闭后焦点可预测。 [H-TABS](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:351)、[W-DETAIL](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:397)|
|U11|弹窗与确认交互|部分|新建/详情用自定义dialog，归档仍用window.confirm；大小和按钮位置分散。|统一Dialog，取消、Esc、焦点归还一致。 [W-CREATE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:822)、[W-OTHER](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:792)|
|U12|状态标签|部分|主分析有四色胶囊，管理表只有单色文字。|所有页面同一状态词典与样式。 [H-TABLE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:868)、[W-TABLE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:609)|
|U13|成功/失败反馈|缺陷|备份成功调用safeError并使用role=alert与红色wm-message。|成功绿色/中性状态，失败可重试并定位原因。 [W-OTHER](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:792)、[W-WORK](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:61)|
|U14|加载与忙碌|部分|主页有骨架，管理页主要进度细线；忙时控件外观未禁用但点击被吞。|明确占位、进度、取消/禁用和保存状态。 [W-WORK](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:61)|
|U15|空数据与错误状态|部分|多数表和排名有空提示；环图参数错误破坏空态，零记录趋势仍绘制小数刻度。|空/无匹配/无数量来源/读取失败分开。 [G-DONUT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-graphics.js:178)、[G-COMBO](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-graphics.js:50)|
|U16|表格密度与对齐|部分|主表可选密度，管理表固定10px；数值列、操作列与截断规则不统一。|统一列宽、数字对齐、悬停全文及键盘可达。 [H-TABLE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:868)、[W-TABLE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:609)|
|U17|表格分页|部分|主表仅上一页下一页，管理预览仅最近5条；与图中页码及每页条数不符。|共用分页器，预览有更多入口。 [H-TABLE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-studio.js:868)、[W-TABLE](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:609)|
|U18|图形数值与百分比|部分|柱线已有数值/横线；条形少占比、环外标签缺失，计数轴在小量时可能显示0.25条等刻度。|条数轴用合适整数刻度，单位和占比直接可读。 [G-COMBO](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-graphics.js:50)、[G-DONUT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-graphics.js:178)、[G-RANK](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-graphics.js:228)|
|U19|图形配色和交互|部分|图形共享HomeGraphics，但两页调用约定不一致，管理页环图确定出错。|统一图表API，增加契约及界面交互测试。 [G-DONUT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/home-graphics.js:178)、[W-DONUT](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.js:569)|
|U20|浅/深色和高对比|部分|存在主题规则，但管理页深色未覆盖--hs-text/--hs-muted，图形文字仍使用浅色模式的深字。|每主题复核正文、图形、弹出层和选中态。 [W-DARK](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.css:822)、[W-CSS](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/workspace-manager.css:5)|
|U21|右上原生窗口按钮|待验证|仍用Electron原生标题栏覆盖层，未实际点击验证本候选；不同画布颜色也需核对。|最小化/最大化/还原/关闭和拖动均实际验收。 [WINDOW](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/main.js:156)|
|U22|旧录入/BI/二维码UI|待验证|入口与源码保留，但它们不在两张参考图中，本轮未逐页视觉验收，不能声称全软件UI一致。|31个路由入口及独立管理页另做逐页状态检查。 [NAV-MODEL](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/交付审阅/程序/resources/app/platform/desktop/app/navigation-model.js:7)|

## 不应为了像图片而改错的内容

- 图中数字、工单、管理员与通知数是示例。不能填入真实界面冒充业务结果。
- 责任人必须有独立字段来源，不能把跟进负责人直接改名为生产责任人；报检人同样独立。
- 异常记录条数、不良件数、不良率需分开。图中环图若按件数显示，必须有能按异常类型关联的真实件数，不得换个标题继续画条数。
- 发生时刻、创建/保存时间、检验业务日和发现日期不是一个字段。时段图要有真实发生时间。
- 启动不要求新密码已经实现；旧密码文件的解密保护继续保留。本机备份仍需原账户与程序配置。

## 后续修复顺序与放行条件

1. **先修统计和交互错误**：B01环图、B02范围、B03排序、B04卡片刷新、B05重命名。先增加能真实失败的用例，再修复；保留本候选供回退。
2. **统一工作区上下文**：真实工作区ID、已应用范围、指标口径、分析方案和数据来源明确传递；分析视图改称“分析方案”，与真实工作区标签区分。保留模块独立记忆，只在用户明确的查询上下文中继承范围，不用全局配置覆盖各模块方案。
3. **统一组件与导航**：一个导航、一个StatusTag、一个查询范围条、统一Single/MultiSelect、DateRange、MetricCard、ChartPanel、TablePager和反馈弹窗。修复小字号、图标、深色变量、忙时无反馈。
4. **补图中功能**：真实工作区标签、指标前期比较、图表维度/口径选择、每图下载放大、完整分页及更多记录入口。责任人与发生时间等先补模型和映射。
5. **最后验证视觉**：GPT浏览器访问获准后，在1536×1024先对照两图，随后1440×900、1280×800与不同缩放。每种文本框/下拉/日期/复选/按钮/弹窗验证默认、悬停、焦点、选中、禁用、加载、空值、错误和成功。包括中文输入、长文本、键盘和窗口按钮。

本轮不新增发布版本，不将未修复问题混入“已完成”状态。原保存问题QA-WINDOWS-SAVE-001继续开放；UI差距修复不能替代保存可靠性验收。

## 范围之外与完整入口盘点

两张图未展示原BI、二维码编辑器、完整录入/字段/导入向导的所有内部页面。下面只确认路由目录仍存在，并非逐屏验证其布局或所有按钮。31个路由加独立工作区管理入口仍需分页面验收。

|路由|页面|本轮实际可确认范围|
|---|---|---|
|home|工作台|目录声明/源码继承；未进行可见界面验收|
|legacy-entry|快捷录入|目录声明/源码继承；未进行可见界面验收|
|legacy-records|记录查询|目录声明/源码继承；未进行可见界面验收|
|legacy-followup|待办跟进|目录声明/源码继承；未进行可见界面验收|
|analysis-hub|分析与报表|目录声明/源码继承；未进行可见界面验收|
|legacy-analysis|异常记录趋势|目录声明/源码继承；未进行可见界面验收|
|overview|检验数量与不良率|目录声明/源码继承；未进行可见界面验收|
|bi-trends|BI期间对比|目录声明/源码继承；未进行可见界面验收|
|bi-daily|日报与邮件素材|目录声明/源码继承；未进行可见界面验收|
|bi-home|完整分析报表|目录声明/源码继承；未进行可见界面验收|
|bi-charts|图表中心|目录声明/源码继承；未进行可见界面验收|
|bi-improve|改善前后对比|目录声明/源码继承；未进行可见界面验收|
|data-center|数据管理|目录声明/源码继承；未进行可见界面验收|
|import|检验导入与批次|目录声明/源码继承；未进行可见界面验收|
|data|检验数量明细|目录声明/源码继承；未进行可见界面验收|
|quality-check|数据质量核对|目录声明/源码继承；未进行可见界面验收|
|label-studio|二维码排版|目录声明/源码继承；未进行可见界面验收|
|legacy-settings|异常表头与校验|目录声明/源码继承；未进行可见界面验收|
|bi-data|BI数据与字段|目录声明/源码继承；未进行可见界面验收|
|bi-schemes|BI筛选方案|目录声明/源码继承；未进行可见界面验收|
|bi-groups|人员与工序分组|目录声明/源码继承；未进行可见界面验收|
|bi-people|人员名单|目录声明/源码继承；未进行可见界面验收|
|bi-defects|不良分类与项目|目录声明/源码继承；未进行可见界面验收|
|bi-chk|每日检查量|目录声明/源码继承；未进行可见界面验收|
|bi-dash|驾驶舱设置|目录声明/源码继承；未进行可见界面验收|
|bi-alerts|预警规则|目录声明/源码继承；未进行可见界面验收|
|settings-hub|设置与备份|目录声明/源码继承；未进行可见界面验收|
|legacy-appearance|外观与布局|目录声明/源码继承；未进行可见界面验收|
|legacy-security|密码与自动锁定|目录声明/源码继承；未进行可见界面验收|
|security|备份、恢复与迁移|目录声明/源码继承；未进行可见界面验收|
|bi-tools|BI配置与工具|目录声明/源码继承；未进行可见界面验收|

## 核对文件

- [问题与功能筛选清单](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/验证/双图核对/双图核对清单.csv)
- [隔离数据层复核结果](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/验证/双图核对/合成复核结果.json)
- [源码证据与哈希](D:/项目/BK_MPO来料异常跟进/构建/当前作业/工作区升级/验证/双图核对/核对证据.json)

本次不提供“界面还原度百分比”，因为没有真实截图；也不把代码项数量当作完成率。
