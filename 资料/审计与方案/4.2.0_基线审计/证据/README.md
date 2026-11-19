# 证据复核说明

结果来自独立 QA EXE 与合成数据。测试脚本保留本机路径，跨电脑运行前须改为该电脑的独立解压副本和测试数据目录，不得指向正式 vault。

本机复核：在原审计的测试目录中使用 Node 运行 qa_desktop.js、audit_ui.js、test_vault.js、test_integration_rules.js；完整应用来自原 4.2.0 ZIP。不要同时启动多个使用相同调试端口或 QA 目录的实例。

本证据目录不包含应用 EXE 或用户数据；不是独立软件发布包。ui-audit.json 是最终有效样本，未收录的初次无效尝试在报告中已披露。
