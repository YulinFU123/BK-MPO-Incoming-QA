不良分析面板 V8.1 内网修复版（2026-10-22）

一、这次解决了什么
1. 原包缺失 tzdata：已补齐 tzdata 2026.5。pandas 的 wheel 元数据明确要求 Windows 安装 tzdata。
2. 旧 setup_deps.py 限制 pandas<3 / numpy<2.4，与随附 pandas 3.0.6 / numpy 2.5.4 冲突。现统一为 requirements-py315.txt。
3. 安装仅使用本地 wheels/cp315，--no-index，不自动联网、不跳过 HTTPS 证书校验、不装到系统目录。
4. 安装到临时目录，真实导入成功后替换 libs，旧依赖保存为 libs_previous。
5. 启动器优先 runtime/python.exe，其次 py -3.15，再其次 python；安装、诊断与启动使用同一选择逻辑。
6. 新增 environment_report.txt 环境诊断、install.log 安装日志和 SHA256 校验。
7. 修复并发点击生成导致重复任务、配置文件中途写坏风险、静态文件目录边界判断及文件夹名称含单引号时对话框报错。

二、公司电脑使用步骤
1. 完整解压到自己的可写目录，例如 D:\不良分析面板；不要在 ZIP 里直接双击。
2. 首先双击 环境诊断.bat。随附二进制包仅适配 Windows x64 常规 CPython 3.15，不适配 ARM64、32位、自由线程版。
3. 双击 安装依赖(免管理员).bat，成功后双击 不良分析面板.bat。
4. 已有兼容依赖且导入成功时直接使用；需要离线修复时才安装随附固定版本。
5. 报表验证前先使用演示数据：将面板输入目录改为 演示数据\每日原表，历史和输出目录分别设为 演示历史、演示结果，避免混入正式历史库。
6. 正式使用时改回实际原表目录。保留已有 config.json、历史数据库和每日原表，不要用演示结果覆盖它们。
7. 首次建议用有窗口的 BAT；无黑窗 VBS 适合环境准备完成后使用。

三、依赖清单（已随包提供，无需在公司下载）
pandas 3.0.6 / numpy 2.5.4 / openpyxl 3.1.5 / python-dateutil 2.9.0.post0 /
six 1.17.0 / et-xmlfile 2.0.0 / tzdata 2026.5。
Python 解释器本身不在本包内。“py315”在这里指 CPython 3.15，不是一个独立 pip 包。

四、如果公司电脑仍失败
- 找不到 Python：使用公司批准的 Windows x64 CPython 3.15 完整安装包；通常可选择仅当前用户安装，但公司策略可能禁止，需要 IT 部署。依赖包不能代替解释器。
- 没有 pip：完整安装版可用对应解释器运行 -m ensurepip --user（使用内置资源，不访问网络）；嵌入式 Python 请改用批准的完整安装版。
- not a supported wheel / 平台不匹配：不要改 wheel 文件名，发 environment_report.txt 确认实际 Python 版本、位数和 ABI。
- PermissionError：移到当前用户可写目录；关闭程序后再安装。受控文件夹或应用白名单限制需要 IT 处理。
- DLL load failed：发完整 install.log；需进一步区分解释器、架构与运行库问题，不能仅靠补 tzdata 保证解决。
- 缺 xlrd：当前演示和主流程为 xlsx；如果原始数据是老式 xls，先在 Excel 另存为 xlsx，或另行准备 xlrd。不要改扩展名冒充格式。
- 安装失败：提供 install.log 和 environment_report.txt，不必提供生产原表。

五、外网重新准备离线包
优先在另一台与公司相同版本/架构的联网 Windows 机器上执行：
py -3.15 -m pip download --only-binary=:all: -r requirements-py315.txt -d wheel_download
也可运行 外网下载依赖.bat，指定目标 Windows x64 CPython 3.15 下载。
使用公司允许的介质/渠道传入；不能绕过公司传输或软件执行限制。
随包的 manifest.json 对应本次七个 wheel。下载替换任意 wheel 后不能随意改校验值来绕过检查，应重新核对来源、版本、依赖完整性并生成新的清单。
文档依据：https://pip.pypa.io/en/stable/cli/pip_download/
https://pandas.pydata.org/pandas-docs/stable/getting_started/install.html

六、验证范围与限制
- 7 个 wheel ZIP/CRC 与 Windows 3.15 条件依赖闭包通过检查；清单为本地文件完整性校验，不代表原六个 wheel 已单独完成来源认证。
- Python 语法编译通过。
- 在 Linux / Python 3.12 上分别以 pandas 2.2.3 + numpy 2.3.5、pandas 3.0.6 + numpy 2.5.4 跑完自带六份演示原表。
- 两次均成功生成 28 张工作表，无业务警告；比对 228143 个单元格，仅 6 个导入时间戳不同，其余相同。
- 配置保存、备份与重新读取通过检查。
- 未在 Windows / Python 3.15 上执行 BAT、VBS 或真实安装；未验证公司策略。演示测试不代表全部自定义配置、真实生产数据和 Excel 图表显示均已验证。
- 本次重点为离线环境与可靠性，原统计口径和界面布局保持原方案。
