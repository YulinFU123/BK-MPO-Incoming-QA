from pathlib import Path
import json, shutil

root=Path(__file__).resolve().parent.parent
src=root/'源码'
renderer=src/'renderer.js'
text=renderer.read_text(encoding='utf-8-sig')
start=text.index('    let closeCombo=')
end=text.index('    function renderForm',start)
text=text[:start]+'''    const closeCombo = () => SuggestionBox.close();
    const attachCombo = (input, column, wrap) => SuggestionBox.attach(input, column, wrap, currentRecords);

'''+text[end:]
renderer.write_text(text,encoding='utf-8')
html=src/'index.html'
text=html.read_text(encoding='utf-8-sig')
text=text.replace('<link rel="stylesheet" href="base.css">\n  <link rel="stylesheet" href="desktop.css"><link rel="stylesheet" href="workstation.css">','<link rel="stylesheet" href="app.css">')
text=text.replace('版本 4.0.0','版本 4.1.0').replace('<script src="renderer.js"></script>','<script src="combo-box.js"></script><script src="renderer.js"></script><script src="workspace-ui.js"></script>')
text=text.replace('先扫描识别，再补齐异常；每项规则都在输入框下方。','扫描 SN，补齐异常内容，核对后保存。').replace('本表头今日记录','今日').replace('本表头全部记录','全部')
html.write_text(text,encoding='utf-8')
(src/'foundation.css').write_text('/* Retained layout for data tables, analytics and legacy dialogs.\n   New control and shell styles live in explicit higher cascade layers. */\n'+(src/'base.css').read_text(encoding='utf-8-sig')+'\n'+(src/'desktop.css').read_text(encoding='utf-8-sig'),encoding='utf-8')
# Old styles remain recoverable inside the complete 4.0 release.
for name in ['base.css','desktop.css','workstation.css']:
    (src/name).unlink()
package=json.loads((src/'package.json').read_text(encoding='utf-8-sig'))
package['version']='4.1.0'
(src/'package.json').write_text(json.dumps(package,ensure_ascii=False,indent=2),encoding='utf-8')
build=root/'构建'/'异常记录台_4.1.0_Windows_x64'
shutil.copytree(root/'构建'/'异常记录台_4.0.0_Windows_x64',build,dirs_exist_ok=True)
app=build/'resources'/'app'
for name in ['base.css','desktop.css','workstation.css']:
    (app/name).unlink(missing_ok=True)
shutil.copytree(src,app,dirs_exist_ok=True)
qa=root/'验证'/'qa_desktop.js'
text=qa.read_text(encoding='utf-8-sig').replace('异常记录台_4.0.0_Windows_x64','异常记录台_4.1.0_Windows_x64').replace('9290','9291')
qa.write_text(text,encoding='utf-8')
print('Prepared 4.1')
