# 文件夹分析架构与兼容性决定

以0.15.0-dev.1为只读保护基线，修改仅在workbench/platform。原始291个保护文件、原BI73文件及加密业务仓储不修改；本次是新增独立分析能力，没有就地业务数据迁移。

|层次|代码|职责|
|---|---|---|
|界面|desktop/app/analysis-studio-ui.js、analysis-source-ui.js、analysis-studio.css|五个页签、来源草稿、筛选器、图表、明细与报告操作；不直接读磁盘|
|契约|domain/analysis-studio.js|字段ID、配置/草稿验证、日周月默认值、筛选操作及输入范围|
|报告布局|domain/a4-report.js|纯函数毫米网格、标题换行、坐标、数据标签、刻度、单页与显式分页；主进程和界面共用|
|本机边界|desktop/analysis-studio-host.js|可信IPC调用、会话检查、保存/打开对话框、来源确认、取消、导出快照校验与恢复补偿|
|分析进程|desktop/lab_worker.py|隔离Python进程，继承stdin/stdout通讯，不开HTTP端口|
|文件解析|desktop/lab_engine/tabular.py|只读XLSX/CSV、表头定位、稳定列ID、日期解释、原始行验证|
|资料仓储|desktop/lab_engine/store.py|独立版本化SQLite、按文件事务导入、来源/批次追溯、同名同日期修订、去重与有界缓存|
|指标|desktop/lab_engine/analysis.py|Excel式筛选、选项联动、日周月聚合、分母口径、排名、覆盖检查和分页|
|服务/导出|desktop/lab_engine/service.py、exports.py|操作分派、报告真实数据快照、PDF/PNG/Excel、独立备份与恢复|

持久化配置沿用现有加密模块状态服务，不增加localStorage大对象。作用域是当前工作区→来源ID→day/week/month；全局导航/主题与旧模块不互相覆盖。正式业务记录、来源草稿、分析资料与短期缓存分别存储。

来源ID与字段ID不依赖显示顺序；字段ID按规范表头和同名出现次数生成，结构签名不依赖列重排。责任员工和报检人分别映射，同一列不能兼任两个业务字段。新增文件结构发生不兼容变化时停止该文件，不擅自采用新映射。

缓存仅在分析进程内，最多3组且合计10万行；以数据库路径、修订号、当前连接变更数、SQLite外部数据版本、来源映射和日期范围为键。新导入、同连接修改或另一连接提交后失效。缓存不作为恢复依据，进程退出可重算。

报告保存查询定义而非统计副本；每张图加入时冻结有效日期。导出前核对数据库修订和配置摘要，再在主进程用同一排版函数重建，Python再校验快照与页面边界。导出不覆盖已存在的文件。

备份包含独立数据库和配置校验，不等同旧业务备份。恢复需空分析库，数据库完整性、版本、表结构和ZIP成员均检查；配置落盘失败仅允许对同一恢复修订执行空库补偿，不删除后续导入。会话变化丢弃迟到响应。

采用既有Electron/原生DOM/Python/openpyxl，不引入前端或桌面框架。补充本机已有同Python ABI的ReportLab/Pillow生成报告，pypdf仅用于包内离线测试；构建复制依赖和许可证，无联网安装。Windows系统字体只运行时读取，不随包分发完整字体文件。

设计取舍：固定页签分离高频分析与低频来源配置；四个既有主题共用颜色和边界；数值、单位、覆盖说明优先，不增加装饰图标。主布局使用4/8/12/16/24间距，借鉴[Fluent 2布局](https://fluent2.microsoft.design/layout)的网格与自适应原则；这是实现决定，并非官方强制要求。[openpyxl官方图表说明](https://openpyxl.readthedocs.io/en/stable/charts/introduction.html)用于原生图表导出。Apple资料页面在本环境未取得完整正文，未把具体视觉参数冒充Apple官方规定。
