# 本轮参考扩展

用户提供BI_NC_Exporter_043202.zip，原始SHA-256为09f40ec7dee20a4e4b6da9c877e1c906e3d4463405851f6b0091dc1cd6204eb6。integrations/ncx-extension为增量分支，保留原作者代码注释；未执行原安装/卸载脚本，不包含原host日志。原包只在本地项目保护基线中保留。

# 第三方依赖记录

0.2版本新增一个随包固定的 XML 解析依赖，替代浏览器环境的 DOMParser。没有运行时下载或 npm 安装流程。

|项目|记录|
|---|---|
|名称/版本|@xmldom/xmldom 0.9.12|
|来源|https://github.com/xmldom/xmldom|
|许可|MIT，完整原文随 vendor/xmldom/LICENSE 保留|
|用途|解析已经过大小、编码、DTD/实体声明检查的 OOXML 文本|
|范围|vendor/xmldom 原包 15 个文件，约 440KB；无传递依赖|
|完整性|下载时校验 npm registry 提供的 SHA-512；包及文件 SHA 记录于 vendor/manifest.json|
|安装脚本|未执行；通过相对路径直接引用，不依赖全局包|

设计取舍：保留现有 JavaScript/Electron 方向，该阶段不引入完整 Excel 计算引擎或Python运行环境。ZIP 和受支持单元格语义在适配器内实现并限制范围；XML 语法解析使用维护中的专用实现。代价是需要随开发包维护固定库和复核上游更新。

官方依据：[xmldom 文档](https://github.com/xmldom/xmldom)、[Microsoft SpreadsheetML](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document)。完整性和许可核对不代表完整供应链安全审计或没有漏洞。

## 0.3 离线运行环境

完整复用原BI新增Python3.12.14及实际验证的pandas3.0.1、numpy2.3.5、openpyxl3.1.5、python-dateutil2.9.0.post0、six1.17.0、et_xmlfile2.0.0、tzdata2026.5。具体以程序runtime-versions.json及各dist-info/METADATA为准。原CP315锁文件原样保留，未据此安装。

Python许可随运行时根目录，pandas/NumPy/dateutil/six等许可随包目录与dist-info保留；NumPy附带原生数学库许可。Electron/Chromium沿用已存在的授权运行时及LICENSE、LICENSES.chromium.html。没有以完整源码审计替代依赖许可文件或安全评估。

开发格式化工具Prettier3.6.2只放当前构建作业工具目录：从npm官方registry读取发布元数据并核对SHA-512，不执行包安装脚本；不是应用运行依赖。项目.prettierrc.json和.editorconfig随源码交付。
