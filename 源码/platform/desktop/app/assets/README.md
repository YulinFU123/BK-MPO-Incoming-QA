# 平台标志

logo.svg是本项目原创的记录括线与分析路径，统一用于登录面板及侧栏。没有使用Apple、Microsoft商标或系统图标。

logo.png为256px窗口图标资源；logo.ico包含16/24/32/48/64/128/256px帧。Windows窗口中实际显示效果仍须实机验收；本轮不改写Electron EXE文件的资源图标。

重新生成：在已具备Sharp的构建工具环境运行`node scripts/render-brand.js <工具node_modules绝对路径>`。此工具只将原创SVG渲染为PNG/ICO，应用离线启动不需要Sharp、Node安装或网络。
