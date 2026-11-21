// Step order follows domain/guides.js. Rectangles are percentages of the individual image.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GuideTools = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  return {
    "label-studio": [
      {"file":"assets/guide-tools/label-studio-01.png","label":"本批内容：统一名称","rect":[28.66,42.57,16.1,14.59],"kind":"capture"},
      {"file":"assets/guide-tools/label-studio-02.png","label":"标签宽、高（毫米）","rect":[61.95,41.89,29.39,15.95],"kind":"capture"},
      {"file":"assets/guide-tools/label-studio-03.png","label":"添加条形码（随编号生成 Code128）","rect":[45.12,45.14,9.76,9.73],"kind":"capture"},
      {"file":"assets/guide-tools/label-studio-04.png","label":"每页预览、翻页与单张放大","rect":[3.56,41.62,92.88,16.49],"kind":"capture"},
      {"file":"assets/guide-tools/label-studio-05.png","label":"立即记住当前排版","rect":[61.95,45.14,10.24,9.73],"kind":"capture"}
    ],
    "settings-hub": [
      {"file":"assets/guide-tools/settings-hub-01.png","label":"显示与访问设置","rect":[15.89,23.61,68.28,52.61],"kind":"capture"},
      {"file":"assets/guide-tools/settings-hub-02.png","label":"备份与恢复：数据安全入口","rect":[42.52,39.97,54.56,19.89],"kind":"capture"},
      {"file":"assets/guide-tools/settings-hub-03.png","label":"恢复到新文件前的说明","rect":[29.88,32.3,67.2,35.27],"kind":"capture"}
    ],
    "security": [
      {"file":"assets/guide-tools/security-01.png","label":"当前工作区与存储状态","rect":[3.03,26.92,94.95,22.18],"kind":"capture"},
      {"file":"assets/guide-tools/security-02.png","label":"保存加密备份（工作区基本资料）","rect":[27.07,45.14,12.2,9.73],"kind":"capture"},
      {"file":"assets/guide-tools/security-03.png","label":"选择备份并恢复（先保护原件）","rect":[43.17,45.14,13.66,9.73],"kind":"capture"},
      {"file":"assets/guide-tools/security-04.svg","label":"升级副本与原版：逐项对照区","rect":[3.13,31.82,93.75,45.45],"kind":"diagram"}
    ],
    "configuration-memory": [
      {"file":"assets/guide-tools/configuration-memory-01.png","label":"查看模块：工作区与全局范围","rect":[13.41,45.11,73.17,9.73],"kind":"capture"},
      {"file":"assets/guide-tools/configuration-memory-02.png","label":"保存命名方案","rect":[43.17,45.03,13.66,9.73],"kind":"capture"},
      {"file":"assets/guide-tools/configuration-memory-03.png","label":"确认仅重置或恢复当前模块","rect":[13.41,47.32,73.17,5.27],"kind":"capture"}
    ],
    "function-search": [
      {"file":"assets/guide-tools/function-search-01.png","label":"侧栏「查找功能」","rect":[1.75,26.32,30.35,9.47],"kind":"capture"},
      {"file":"assets/guide-tools/function-search-02.png","label":"功能搜索输入框","rect":[13.66,44.56,72.68,10.81],"kind":"capture"},
      {"file":"assets/guide-tools/function-search-03.png","label":"当前选中的搜索结果","rect":[8.29,40.8,83.41,18.54],"kind":"capture"}
    ],
    "label-design": [
      {"file":"assets/guide-tools/label-design-01.png","label":"模板方式：自定义模板","rect":[61.95,42.7,29.39,14.59],"kind":"capture"},
      {"file":"assets/guide-tools/label-design-02.png","label":"所选对象与多选提示","rect":[61.95,45,29.39,9.73],"kind":"capture"},
      {"file":"assets/guide-tools/label-design-03.png","label":"创建副本（Ctrl+D）","rect":[45.49,45.14,8.29,9.73],"kind":"capture"},
      {"file":"assets/guide-tools/label-design-04.png","label":"所选文字的字号","rect":[61.95,42.7,13.96,14.59],"kind":"capture"},
      {"file":"assets/guide-tools/label-design-05.png","label":"保存当前设计为方案","rect":[61.95,45.14,10.24,9.73],"kind":"capture"}
    ],
    "label-batch": [
      {"file":"assets/guide-tools/label-batch-01.png","label":"单张标签设计画布","rect":[21.99,7.22,55.9,85.49],"kind":"capture"},
      {"file":"assets/guide-tools/label-batch-02.png","label":"完整编号，每行一个","rect":[28.66,28.51,33.66,42.7],"kind":"capture"},
      {"file":"assets/guide-tools/label-batch-03.png","label":"纸张与自动排版：横向间距","rect":[28.66,42.7,16.1,14.59],"kind":"capture"},
      {"file":"assets/guide-tools/label-batch-04.svg","label":"试印缩放：实际大小（100%）","rect":[5.21,46.36,48.96,14.55],"kind":"diagram"}
    ],
    "label-data": [
      {"file":"assets/guide-tools/label-data-01.png","label":"内容输入方式：逐行数据","rect":[26.59,45.14,20.12,9.73],"kind":"capture"},
      {"file":"assets/guide-tools/label-data-02.png","label":"粘贴编号、名称、规格、制作人","rect":[2.62,35.41,94.77,29.19],"kind":"capture"},
      {"file":"assets/guide-tools/label-data-03.png","label":"选中行的修改列与统一填写内容","rect":[2.62,42.03,94.77,15.95],"kind":"capture"},
      {"file":"assets/guide-tools/label-data-04.png","label":"同时记住本批编号及逐行数据","rect":[61.95,45.14,29.39,9.73],"kind":"capture"}
    ],
    "label-fit": [
      {"file":"assets/guide-tools/label-fit-01.png","label":"目标宽度（毫米）","rect":[42.68,41.89,14.63,15.95],"kind":"capture"},
      {"file":"assets/guide-tools/label-fit-02.png","label":"适配方式：保留版式缩放或按内容重排","rect":[42.68,41.89,14.63,15.95],"kind":"capture"},
      {"file":"assets/guide-tools/label-fit-03.png","label":"适配后的单标签预览","rect":[27.83,28.64,22.77,42.95],"kind":"capture"},
      {"file":"assets/guide-tools/label-fit-04.png","label":"确认预览后应用适配","rect":[39.39,45.14,10.24,9.73],"kind":"capture"}
    ]
  };
});
