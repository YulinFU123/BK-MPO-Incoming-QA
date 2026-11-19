# 选择控件统一方案 · 0.3.1-dev.1

对象是离线质量记录与BI工作台：高频扫码、重复输入、长中文异常、文本编号与筛选。原41文件和BI73文件保持只读基线；改动位于融合呈现层，不改数据协议。

## 诊断与方案

上一轮统一了外壳与底色，未统一展开层。旧录入候选叠加多套CSS，仍存在硬编码白底；原生select由浏览器绘制；BI的datalist无法统一样式。普通fixed候选在模态dialog后面也可能不可见。只改输入框外观无法解决这些问题。

1. 单选使用浏览器支持的可定制select（base-select）及顶层picker，保留原select、option、value、原onchange、禁用/必填及键盘语义。只增加CSS，不复制控件，不重写业务事件；不支持该标准时保留原生回退。
2. 原异常录入的可编辑候选保留原逻辑；统一浮层、选中、悬停、字体，并提升到popover顶层；保持输入过滤与扫码回车策略。
3. BI的input[list]增加轻量可编辑候选适配器。选中只填值并发送原input/change事件；标签加入仍按原来的回车或离焦规则，不偷偷新增预设。不解析HTML，不转换编号大小写或前导零。

## 令牌与布局

- 雾银：画布 #eef2f6，控件 #fbfcfd，浮层 #f7f9fc（适度透背景），正文 #142333，分隔 #c8d2de，操作蓝 #0969c8。
- 石墨：画布 #171e27，控件 #242e3b，浮层 #2c3644，正文 #edf2f8，分隔 #46566a，操作蓝 #82b8ff；高亮文字使用深色以保持对比。
- 字体采用系统UI字族：Windows Segoe UI / 微软雅黑；可用平台才使用系统Apple字体，不分发苹果专有字体。
- 控件高36px（沿用可调字号）；菜单行至少32px，内边距6/10px、圆角6px；浮层圆角10px、外层细边与一层短阴影。长中文允许折行。
- 单选和可输入候选均对齐触发字段，向可用空间展开，限制在窗口内；只有浮层使用材质。表格和文字内容保留实底。
- 键盘焦点与当前选中是不同状态。当前选中保留状态标记，鼠标/键盘活动行突出显示；禁用项降低强调但保持可辨。减少动态效果与高对比使用实色回退。

布局：

```text
字段名
[ 当前值或输入文本                      v ]
  ┌─────────────────────────────────────┐
  │ 已选值                       当前状态│
  │ 另一个候选                           │
  │ 长中文异常说明，可换行完整阅读        │
  └─────────────────────────────────────┘
```

评审：工业录入需要数据密度和键盘效率，采用macOS可编辑组合框原则；不改为手机滚轮或装饰卡片。用户要求去装饰图标，保留的箭头和选中标记只用于表达控件状态。玻璃是可用主题，不增加新的玻璃开关。

## 官方依据与项目选择

- Apple HIG [Combo boxes](https://developer.apple.com/design/human-interface-guidelines/combo-boxes)：把编辑与候选结合，提供相关选择；自定义输入不自动变成预设。此处用于录入和BI标签，保留原历史候选协议。
- Apple HIG [Pop-up buttons](https://developer.apple.com/design/human-interface-guidelines/pop-up-buttons)：适合互斥状态；选择后关闭并显示当前值。多选增强不改为单选。
- Apple HIG [Menus](https://developer.apple.com/design/human-interface-guidelines/menus)：相同分组内呈现一致、选中状态可辨、控制长度、图标有用途。项目去掉装饰性图标。
- Apple HIG [Materials](https://developer.apple.com/design/human-interface-guidelines/materials)：材质表达导航和控件层级，避免把内容层全部玻璃化。此处CSS材质只是Windows/Electron中的视觉实现，不是AppKit/SwiftUI原生Liquid Glass。
- Chromium [Customizable select](https://developer.chrome.com/blog/a-customizable-select)：base-select暴露可定制顶层选项，保留原JavaScript接口。实际运行的Electron45/Chromium156仍须验证；GPT浏览器预览不能等同Windows原生窗口验收。

颜色、行高、圆角和具体CSS是项目设计决策，不是苹果强制数值。实现成本为一套公共CSS、BI候选适配器与三个呈现入口接入。风险集中在旧样式覆盖、模态浮层、中文输入事件及BI回车处理；逐项在GPT内置浏览器核验，并运行原业务回归。

## 验收

- 雾银/玻璃/石墨/高对比展开菜单内容可读，无白底浅字；悬停、选中、禁用与焦点一致。
- 已填写的字段仍可展开全部选项；输入筛选不抢中文组合输入，方向键与回车可选，Esc/Tab关闭且不擅自改变值。
- 0012、12、A、a保留原文，选择不触发保存；SN扫描回车策略不变。
- 弹窗内菜单可见，页面下缘不裁切，菜单滚动与长文本可用。
- 原select值、排序/筛选回调、数据导入映射及多选配置保留；原源码和受保护ZIP校验不变。
- 区分GPT内置浏览器实际交互、自动化回归、未测试的Windows原生功能；已知QA-WINDOWS-SAVE-001仍待排查，不据UI修改宣称修复。
