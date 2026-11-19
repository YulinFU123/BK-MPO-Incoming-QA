# 原业务完整融合继承与验收清单

0.7延续原34项能力、25原目的地和BI14页，主导航仍7项、目录仍31目的地；二维码页增加单张设计、批量套用和独立记忆，不更改原业务、加密、数据路径或BI协议。测试结果以本轮报告区分UI、自动化及未验收实机项目。

0.6.0继承说明：本清单34项原业务不删减，原25目的地和BI14页保持；新增二维码排版后目录共31个目的地。45项实际入口/布局回归保留原业务与BI路径，新增页24项单独验证；不据此声称原业务全部参数组合或公司实机已验收。本轮不修改原41/73文件、保存模块及数据格式，详见 [二维码方案](LABEL-STUDIO.md) 与交付测试报告。

0.4.0的入口归组、公共动作和宽窄布局变化见 [功能与布局方案](FUNCTIONS-AND-LAYOUT.md)。本清单34项原业务能力继续保留；目录29个目的地包含25个既有目的地和4个新组织页面，不等于只有29项功能。原41文件和BI73文件未改写，公共入口使用固定目标调用原流程；完整业务参数组合仍以实际验收状态为准。

审计日期：2026-10-27。依据：项目 `源码/` 原 41 个桌面文件、`成果/当前版本/程序/使用说明.md`（4.5.0-rc.1）。路径以下相对 `源码/`。

本清单是静态源码/控件契约审计，不是人工操作验收。原功能确有实现与“已经在新平台完整融合”是两件事。新增分析内核、XLSX 数量事实导入或 BI 看板不能替代原来的录入、表头、工作流、草稿与十六表分析。

当前融合方向：同一窗口内复用原业务 `WebContentsView`，新增受信任 `desktop/legacy-preload.js` / `legacy-host.js` 适配原界面所需桌面 API；主会话管理统一新格式，并提供原加密库的只读导入。启动交接的生成补丁不等于可以忽略下表的交互和持久化检查。原文件及原库不得覆盖。

## 状态含义与验收范围

- **保留原实现；细项验证见文末**：以下每项均已找到原实现证据；本次静态审计未运行新桥接后的对应功能。
- **契约待复核**：新增桥接文件需通过本轮 `legacy-fusion-contract.test.js`，但静态契约通过仍不代表业务或界面通过。
- 所有实际验收必须使用独立 QA 库及合成/脱敏数据，记录执行环境、结果和失败证据；不得用用户正式加密库试写。
- 本轮已有只读盘点记录提供原库大小为 4142 字节，本清单没有自行解锁或读取其明文。这只是文件元数据证据；没有用户密码、没有成功解锁证据，不能声称已读出或迁移了真实记录。

## 录入、表头与防呆

|编号|应继承的原能力|源码函数/模块与控件证据|融合验收方式|状态|
|---|---|---|---|---|
|F01|单条新增、编辑、取消编辑|`renderer.js`: `saveRecord`、`startEdit`、`renderForm`、`commitChange`；`entryForm`、`saveRecord`、`cancelEdit`、动态 `field_<columnId>`|保存一条→查询→编辑→取消/再次保存；新平台重开后值与永久记录 ID 保留，原始 `createdAt` 不被重建|保留原实现；细项验证见文末|
|F02|复制记录、删除、恢复最近删除|`duplicateRow`、`deleteRow`；`dataTable` 行操作、`undoDelete`、`state.deletedRecords`|复制不复制 SN；删除后恢复；恢复前重新检查唯一值；失败不吞记录、不改原值|保留原实现；细项验证见文末|
|F03|未完成录入/编辑/配置草稿保存与恢复|`captureSession`、`saveSession`、`restoreSession`、`closeApp`、`performLock`；`state.pendingUI`|填写半张表、进入修改与未保存表头配置→关闭/锁定→重新解锁，核对草稿、编辑 ID、页签与配置草稿；保存失败必须阻止静默退出|保留原实现；细项验证见文末|
|F04|当天日期自动填写、跨日刷新、人工改日期保留|`todayISO`、`autoValue`、`refreshDay`、`restoreSession`；`auto==='today'`、`createdLocalDate`|模拟跨日：只更新仍等于旧自动日期的未修改输入；手改日期/旧记录不变；重启草稿日期策略一致|保留原实现；细项验证见文末|
|F05|录入序号与查询序号自动重排|`nextSequence`、`formValues`、`visibleRecords`、`exportXlsx`；`auto==='sequence'`|连续保存、删除、筛选和排序后查看显示序号连续；导出按结果重新编号；永久 ID 不随序号变化|保留原实现；细项验证见文末|
|F06|多异常类型、新建/复制表头、独立记录|`switchTemplate`、`makeTemplate`、`deleteTemplate`、`saveSettings`；`templateSelect`、`newTemplate`、`duplicateTemplate`、`deleteTemplate`|复制列与联动规则时重映射字段 ID；新类型不混入旧记录；已有记录的表头不能直接删除|保留原实现；细项验证见文末|
|F07|字段名称/类型/顺序/宽度/必填/连续沿用|`renderSettings`、`renderForm`、`saveSettings`；`columnRows`、`addColumn`、动态字段设置；`settingsTab0..3` / `settingsPane0..3`|改名不丢原字段值；上下移动后输入/查询/Excel 顺序一致；长文本、窄窗与取消配置恢复原样|保留原实现；细项验证见文末|
|F08|统一输入规则：字符数、类型、固定开头、预设项、数值上下限/整数/日期|`input-rules.js`: `settings/validate/configurationError`；`input-policy-ui.js`；`policyDialog`、`policy_minLength`、`policy_maxLength`、`policy_kind`、`policy_prefix`、`policy_optionsOnly`、`policy_min/max/integer`|对单条、批量与导入分别输入超限、错字符、控制符、无效日期等；保留原文并拦截，不静默截断；配置无效时不保存|保留原实现；细项验证见文末|
|F09|唯一值勾选及同日/全部范围|`duplicateMode`、`checkDuplicates`、`RecordRules.inspect`；`column.uniqueScope`（`off/today/all`）、字段设置唯一值控件|0012/12、A/a 分开；同日按统计/发现日期；空值不查重但必填独立；编辑自身不误报；导入/恢复删除同样拦截|保留原实现；细项验证见文末|
|F10|扫描枪 Enter 防误保存与短时重复扫描拦截|`handleScan`、`saveRecord`、`recentScans`、键盘事件；`field_sn` / 动态 SN 字段、`entryForm`|用实际扫描枪或等价输入事件：SN 后 Enter 不保存未完成记录；3 秒同值提示；Tab 继续；Ctrl+Enter 仍执行全部校验；按钮 Enter 可正常激活|保留原实现；细项验证见文末|
|F11|批量扫码、共同字段固定、暂存/移除/丢弃/整批确认|`batchRender`、`batchScanForm.onsubmit`、`batchCommit`；`batchDialog`、`batchScan`、`batchList`、`batchDiscard`、`batchCommon`、`state.batchDraft`|共同信息只填一次，重复/无效 SN 不入暂存；关闭不丢批次；未加入 SN 留在输入框时不能整批提交；任一失效值整批拒绝且草稿保留|保留原实现；细项验证见文末|
|F12|输入后仍可展开的候选下拉与键盘焦点|`combo-box.js`: `attach/candidates/show/choose`；`SuggestionBox`、动态输入与候选浮层|输入任意内容后继续开下拉；上下键/回车/Esc、点击外部、长候选、滚动/缩放位置；输入值不被误清空|保留原实现；细项验证见文末|
|F13|条件联动、按 SN 补空白、沿用上一条|`fill-rules.js`、`renderFillRules`、`fillFromSN`、`copyPrevious`；`fillRuleRows`、`addFillRule`、`fillFromSN`、`copyPrevious`|只补空白、不覆盖、不连锁；冲突提示；SN 与自动字段不能错误复用；本次异常仍需核对|保留原实现；细项验证见文末|
|F14|历史常用组合、搜索、预览、补入及可撤销|`fill-history-core.js`、`fill-history-ui.js`、`writeHistoryFields`、`historyContextValid`；`historyFillDialog`、`historyFillSearch/List/Preview/Apply`、`undoHistoryFill`|按频次/最近时间排列；只显示前 30、搜索能找其余；排除 SN/日期/序号/唯一值/关联编号；撤销保留补入后手改值；保存/切换类型/重开表单使旧撤销失效|保留原实现；细项验证见文末|

## 查询、导入导出与分析

|编号|应继承的原能力|源码函数/模块与控件证据|融合验收方式|状态|
|---|---|---|---|---|
|F15|所有业务列升降序与空值/数值/日期/文本排序|`sortRows`、`renderTable`、`state.tableSort`；`dataTable` 的动态表头及排序状态|逐列双向排序，覆盖数字、日期、中文、英文、0012/A/a、空值；切换类型和重启恢复各自排序；显示序号重新连续|保留原实现；细项验证见文末|
|F16|今天/全部、全文检索、可完整查看单元格与键盘表格|`visibleRecords`、`renderTable`；`search`、`data-filter`、`tableScroll`、`dataTable`|超长文本不丢；方向键/Enter 查看完整值、Tab 到当前行操作；今天/全部与搜索结果及计数一致|保留原实现；细项验证见文末|
|F17|高级组合筛选|`matchesQuery`、`addQueryCondition`、`queryApply/queryReset`；`queryStart/End/Status/Owner/Conditions`、`queryAdd`|日期、状态、负责人及多个包含/区分大小写等于/空值条件同时生效；无效日期拦截；清除后恢复；复制/导出只含当前结果|保留原实现；细项验证见文末|
|F18|原异常记录 Excel 导入预览与字段映射|`xlsx-reader.js`、`xlsx-import-ui.js`、`XlsxImportUI.install`、`RecordRules.inspect`；`importExcel`、`xlsxFile`、`xlsxDialog`、`xlsxSheet/Header/Mapping/Preview/Check/Commit`|选表/表头→映射→前 5 行预览→检查；通过记录按原流程导入、拒绝项明示；确认前重新校验上下文/重复；编号与日期正确|保留原实现；细项验证见文末|
|F19|CSV/TSV 导入、CSV 导出及复制为表格|`parseDelimited`、`importDelimited`、`exportCsv`、`copyTable`、`csvCell/excelText`；`importCsv`、`csvFile`、`exportCsv`、`copyTable`|含引号、逗号、换行、制表符、BOM、日期与前导零样本；无效/重复项报告；导出当前筛选范围；表格复制可粘贴到 Excel|保留原实现；细项验证见文末|
|F20|原六表普通导出与十六表分析导出|`exportXlsx(false/true)`、`workbookBlob/sheetXml/xlsxStyles`、`InsightsCore.exportSheets`；`exportXlsx`、`analysisExport`|独立读取生成 XLSX，检查下节所有 sheet 名称/行数/文本编号/冻结行/筛选/列宽/深色表头/横向打印比例；Excel/WPS 实际打开另验|保留原实现；细项验证见文末|
|F21|趋势日期范围、粒度、包含今天、等长前期和移动平均|`AnalyticsCore.rangeFor/build`、`AnalyticsUI.options/render/chart`；`analysisRange/Start/End/Apply/Today/Grain/Reference`|7/30/90/今天/自定义/全部；未应用修改不影响图及导出；完整日期比较、前期为零、7 日均线限制与说明；按日/周/月切换|保留原实现；细项验证见文末|
|F22|趋势/排名/组合钻取及分析筛选清除|`analysisFilter`、`clearAnalysisFilter`、`updateAnalysisFilterChip`、`renderAnalysis`、`AnalyticsUI.rank`；`analysisDimension/Value/Group`、`trendPlot`、`issueBars/codeBars/groupBars/matrixRows`、`analysisFilterChip`|鼠标与键盘激活数据点进入对应原记录，清除恢复；显示实际日期数量；排名展开全部，编号原样区分；不会把分析范围与查询条件混用|保留原实现；细项验证见文末|
|F23|异常增减与重点帕累托|`AnalyticsUI.render`、`InsightsCore.pareto`、`InsightsUI.renderPareto`；`analysisChangeSort`、`changeRows`、`paretoThreshold/Plot/Rows/Expand`|增加/减少/本期排序；70/80/90% 参考、左右轴和累计占比正确；“其他”可钻取，明细与导出保留全部类，不声称根因|保留原实现；细项验证见文末|
|F24|同 SN 多次记录|`InsightsCore.build`、`InsightsUI.renderRepeats`；`repeatSummary/Rows/Expand`|按本期/当前模板/字段范围；0012/12、A/a 分开；缺 SN 不合并；点击原记录；仅提示多次，不自动判误扫、复发或删除|保留原实现；细项验证见文末|
|F25|当前未关闭/超期/未分配、日龄、负责人任务|`InsightsCore.build`、`InsightsUI.renderProcessing`；`processingScope/Kpis/Quick`、`ageRows`、`ownerRows`|当前快照不受发现期限制；缺失/未来日期单列；未设置处理期限与未知状态可见；负责人数量与待办一致|保留原实现；细项验证见文末|
|F26|发现队列关闭占比、发现至关闭天数、排除项|`InsightsCore.closeDate/build`、`InsightsUI.renderProcessing`；`closureCaption/Summary`、`closedRows/Expand`、`processingQuality`|区分发现队列与关闭日期范围；重新打开不算关闭样本；无样本显示“—”；缺关闭日期、未来、起点无效、反向日期有对应排除计数；不称工作小时/SLA|保留原实现；细项验证见文末|

### 导出工作表名称契约

普通“导出 Excel”六张：

1. 记录明细
2. 统计概览
3. 数量趋势
4. 异常分布
5. 关联编号
6. 编号异常组合

“导出分析 Excel”在以上六张之外再含十张，总计十六张：

7. 期间对比
8. 异常增减
9. 趋势对照明细
10. 分析口径
11. 重点异常
12. 同SN多次记录
13. 当前未关闭日龄
14. 负责人当前任务
15. 发现至关闭天数
16. 处理分析口径

源码中“分析口径”的旧版本文本为历史实现，不可把静态版本字符串当成当前宿主版本。不得因为新平台另有 BI 报表就删掉这些原表或替换原统计口径。

## 流程、密码、备份与界面偏好

|编号|应继承的原能力|源码函数/模块与控件证据|融合验收方式|状态|
|---|---|---|---|---|
|F27|处理状态、负责人、期限、结果、重新打开与修改历史|`openWorkflow`、`workflowForm.onsubmit`、`addHistory`、`showRecordHistory`；`workflowDialog/Status/Owner/Due/Result`、`historyDialog/Text`|待处理→处理中→关闭→重新打开；关闭结果必填校验；历史保留修改前内容；处理与主记录修改一并持久化|保留原实现；细项验证见文末|
|F28|待办看板跨类型、负责人、状态/超期/未分配及导出|`followupRows/Info/renderFollowup`；`followupScope/Owner/Status/List/Export`|同日到期不算超期、无期限排后；查询筛选不污染看板；当前/全部类型切换；导出只含当前待办结果|保留原实现；细项验证见文末|
|F29|首次设置、解锁、修改密码与手工锁定|`startAuth`、`enterWorkspace`、`openSecurity`、`performLock`、`vault.js`；`authForm/Password/Confirm/Submit`、`lockBtn`、`securityForm`、`currentPassword/newPassword/repeatPassword`|统一宿主一次解锁后原页面进入；密码修改后旧新备份密码语义正确；错误密码不覆盖；旧页不能自行创建/覆盖原正式库；锁定两视图一致|保留原实现；细项验证见文末|
|F30|自动锁定、活动通知、关闭前草稿握手|`main.js` 空闲检查与 `timeoutValue`；`renderer.js` `saveSession/performLock/closeApp`；`idleMinutes`、`vault:activity/lock-request`、`app:close-request/close-ready`|0/5/10/15/30 分钟；父窗口/原视图活动都计入；自动锁前先保存草稿；失败不默默锁/关；Alt+F4及关闭按钮同流程|保留原实现；细项验证见文末|
|F31|已解锁导入旧/明文备份与锁定页加密恢复|`backup`、`restore`、`lockedRestoreFile` handler；`backupBtn/sideBackup`、`restoreBtn/backupFile`、`lockedRestoreBtn/File`；`desktop.backup/readBackup/restore`|两条恢复路径分别验证：解锁页导入通常替换原业务状态并按当前密码重加密；锁定页恢复会替换原状态/密码，需明确说明和确认；失败不丢原数据|保留原实现；细项验证见文末|
|F32|每日自动加密备份及保存失败反馈|`main.js` `vault:save`、`daily-backup.js ensureDailyBackup`；`backupWarning`、`notice`|当日首次成功保存产生完整密文备份，已存在不覆盖；备份失败保留“业务已保存但备份失败”区别；统一全量库与原业务备份范围说明清楚|保留原实现；细项验证见文末|
|F33|四套基础风格及增强项、密度/字号、预览取消|`appearance.js` `clean/apply/fill/read/open`；`openAppearance`、`appearanceDialog/Form`、`themeChoices`、`appearanceReset/Cancel`；`qualityDeskUIPreferences`|深海蓝/液体玻璃/石墨深色/高对比可用；行间底色/加强表头/强调输入/减少动态可组合；舒适/紧凑、标准/较大；取消、Esc及关闭恢复应用前；重启保留本机偏好|保留原实现；细项验证见文末|
|F34|窗口最小化/最大化还原/关闭、可拖动缩放、原菜单与焦点|`window-shell.js`、`window-ui.js`、`ActionMenu`、`workspace-ui.js`；`[data-window-action]`、`actions_fillFromSN`、`actions_importCsv`|同窗视图切换不遮盖原生/自定义按钮；三个窗口动作实际点击；滚动/缩放菜单不漂移，Esc/方向键/Home/End；弹窗焦点不被菜单抢回|保留原实现；细项验证见文末|

## 全量状态与桌面桥接契约

融合必须保存完整的原 v1 状态，不得只转换为分析 `Observation` 后丢弃其余字段。至少逐项检查：

|状态范围|原字段/用途|继承要求|
|---|---|---|
|表头与当前上下文|`version/prefix/datePattern/activeTemplateId/templates`；每套 `columns/analysis/fillRules`|保留原字段 ID、输入规则、唯一值、连续沿用、布局与条件规则，不能依列名猜测重建|
|业务记录|`records` 的 `id/templateId/createdAt/createdLocalDate/updatedAt/values`|保持永久 ID、所有自定义值、原日期和文本编号|
|处理与历史|记录内 `workflow/history`|负责人、期限、结果、关闭日期、历史修改快照全部保留|
|删除与批次|`deletedRecords/batchDraft`|恢复删除与未提交扫码批次保持原语义|
|会话/设置草稿|`pendingUI`（`templateId/values/savedLocalDate/editingId/view/settingsDraft`）|关闭或锁定交接时先保存；重新进入原页按原流程恢复|
|行为设置|`tableSort/security` 等原有和未来扩展属性|未知但合法的原业务属性不得因新分析 schema 只认可几个字段而被删掉|
|本机外观|`localStorage.qualityDeskUIPreferences`、兼容旧 `qualityDeskAppearance`|不属于业务备份。新进程/新 partition 可能读不到旧偏好，须明确迁移策略，不将“控件存在”称为原偏好已恢复|

原 `preload.js` 的 `desktop` 共 18 个方法，原代码当前全部或间接依赖。新桥接必须满足相同返回值和时序，而非仅同名：

|类型|方法|原通道/要求|
|---|---|---|
|异步认证/读取|`status/setup/unlock/changePassword/restore/readBackup`|原 `vault:status/setup/unlock/password/restore/read-backup`；返回 Promise，成功 `{ok:true,value}`，失败 `{ok:false,error}`|
|同步保存/备份/锁定|`save/backup/lock`|原 `vault:save/backup/lock`；原 renderer 立即检查返回值，不能改成 Promise 而仍宣称复用无改动|
|单向通知|`activity/setTimeout/closeReady`|原 `vault:activity/vault:timeout/app:close-ready`|
|窗口异步|`windowState/windowMode/windowControl`|原 `window:state/mode/control`；可将原窗口动作适配到统一父窗口，但仍需受信任校验|
|事件订阅|`onLockRequested/onCloseRequested/onWindowChanged`|原 `vault:lock-request/app:close-request/window:changed`；回调不应接收 Electron 特权 event 对象|

新通道可以使用独立 `legacy:*` 前缀以免和旧 host 冲突；不得暴露通用 `ipcRenderer`、任意文件路径/命令或凭据。启动交接可新增只读 `handoff` 方法，但不替代以上原 API。

特别兼容点：原 `renderer.restore()` 只在备份 `format==='quality-desk-encrypted-vault'` 时调用 `desktop.readBackup`，其他对象按旧明文 v1 校验。若新桥接返回统一新格式的加密备份，必须提供兼容导出，或在生成补丁中明确扩展该格式判断并加恢复回归；不能只测试锁定页 `desktop.restore` 就认为解锁页也通过。原记录备份与统一全量备份若范围不同，界面必须明确命名，避免以为已备份 BI 数据。

## 本次自动化与尚未完成事项

`tests/legacy-fusion-contract.test.js` 检查原 41 文件中的 `desktop` 调用集合、新旧 preload API、同步方法保留以及新 preload 通道在 host 中有声明。此测试使用假 Electron 的静态/调用契约，不操作正式密码、原库或真实窗口，不证明所有 IPC 处理的存储行为正确。

随后还需：实际同窗 QA 库完整 CRUD/草稿/批次/工作流/十六表导出、两条备份恢复、保存失败与自动锁定、重启恢复、四风格与增强项、Windows 鼠标/键盘/扫描枪、高 DPI、窗口按钮与焦点、真实 Excel/WPS 打开打印、目标无 IT 权限内网验收。

BI V10.2 项目源码/完整包仍不可访问。此前工作流说明不等于源码或真实公司导出成功。数量事实导入与新 BI 分析要保留来源、检验分母、粒度和不可计算状态；当前不能列出“已继承全部 BI 原功能”。

正式发布前，逐项把本表状态更新为已通过/已失败/未测试/因环境无法验证，并附实际证据。未完成项不能被一个总测试通过数覆盖。原 41 文件、当前/上一程序包、原始基线与旧库保持只读保护；所有生成补丁、测试快照及截图留在当前作业。

## 0.3 本轮实测补充（2026-10-27）

上表为继承清单；只有以下明确列出的界面操作作为本轮实际窗口证据，其他配置组合仍标记未测试。

|检查|状态|证据与范围|
|---|---|---|
|原11字段、当天日期、必填提示|已通过|隔离示例窗口实际打开，日期为2026-10-27|
|扫描枪回车保护|已通过键盘模拟|合成SN后按Enter，提示仅读取SN、未保存；实物扫描枪未测试|
|输入后继续选择下拉候选|已通过|输入“底座”后展开、选择“底座断裂”|
|带前导零丝印及保存|已通过|输入0012、点击保存，提示继续下一条，序号增加|
|所有列的排序入口及NO双向排序|已通过所列范围|11个可排序业务表头；90条示例按NO↑/↓后首行SN改变，显示序号连续。其他每列逐个双向点选未完成|
|外观主题同步、预览与取消|已通过|石墨记录列表无浅色混搭；原外观弹窗预览高对比同步主窗口，取消恢复石墨；布局/字体/多选增强仍保留|
|Windows原生窗口按钮|已通过|实际最大化、恢复、最小化后恢复、关闭；关闭后的进程退出已确认|
|BI趋势与完整报表|已通过所列范围|原示例趋势、排行、日期缺口；窗口实际生成28工作表、127图表、5236公式，独立读取通过|
|锁定/关闭后的BI示例清理|已通过|正常关闭后进程退出，独占示例目录已清理，不涉及正式工作副本|
|新BI深色控件修正|已通过所列页面|实际检查趋势/筛选/分组控件；浅底浅字已修正；其他页面所有组合仍待验收|

真实用户vault没有解锁、没有试写；未执行公司BI网页脚本或发送邮件。自动化代码契约不能替代未列出的旧业务完整操作验收。

趋势页默认先显示曲线和指标，复杂筛选可展开；已实际展开、使用“全部数据”更新到2026-10-13至19，再收起核对9511 pcs及日期缺口。这个界面调整不改原统计口径。
