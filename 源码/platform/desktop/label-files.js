'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const model = require('../domain/label-layout');
const render = require('./label-render');
const { png, zip } = require('./label-assets');
const { labelsFromWorkbook, exportWorkbook } = require('./label-workbook');
const { PlatformError } = require('../domain/errors');
function createLabelFiles({ controller, pick, save, printDocument }) {
  const sources = new Set();
  const context = () => {
    const state = controller.hostContext();
    if (!state.unlocked) throw new PlatformError('WORKSPACE_LOCKED', '请先打开工作区。');
    return state.sessionId;
  };
  const guard = (token) => {
    if (context() !== token)
      throw new PlatformError('SESSION_CHANGED', '工作区已变化，请重新操作。');
  };
  return Object.freeze({
    clear: () => sources.clear(),
    async pick() {
      const token = context(),
        file = await pick();
      guard(token);
      if (!file) return { cancelled: true };
      if (path.extname(file).toLowerCase() !== '.xlsx')
        throw new PlatformError('LABEL_INPUT', '请选择普通XLSX工作簿。');
      const handle = await fs.open(file, 'r');
      let bytes;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size <= 0 || stat.size > 25 * 1024 * 1024)
          throw new PlatformError('FILE_SIZE_LIMIT', '工作簿为空或超过25MB。');
        bytes = await handle.readFile();
        if (bytes.length > 25 * 1024 * 1024)
          throw new PlatformError('FILE_SIZE_LIMIT', '工作簿超过25MB。');
      } finally {
        await handle.close();
      }
      const result = labelsFromWorkbook(bytes);
      guard(token);
      sources.add(path.resolve(file).toLowerCase());
      return { cancelled: false, fileName: path.basename(file), ...result };
    },
    async export(input) {
      const token = context();
      if (
        !input ||
        Object.keys(input).some((k) => !['format', 'config', 'records'].includes(k)) ||
        !['xlsx', 'png', 'pdf', 'print'].includes(input.format)
      )
        throw new PlatformError('LABEL_ARGUMENT', '标签导出参数无效。');
      let plan;
      try {
        plan = model.plan(input.config, input.records);
        for (let i = 0; i < plan.pages; i++) render.pageSvg(plan, i);
      } catch (error) {
        throw new PlatformError('LABEL_LAYOUT', error.message);
      }
      if (input.format === 'print') {
        guard(token);
        await printDocument(plan, { print: true, authorize: () => guard(token) });
        guard(token);
        return { printed: true };
      }
      const extension = input.format === 'png' ? 'zip' : input.format;
      const file = await save(extension);
      guard(token);
      if (!file) return { cancelled: true };
      if (path.extname(file).toLowerCase() !== '.' + extension)
        throw new PlatformError('LABEL_OUTPUT', '导出扩展名与所选类型不一致。');
      if (sources.has(path.resolve(file).toLowerCase()))
        throw new PlatformError('LABEL_SOURCE_PROTECTED', '不能覆盖读取的原工作簿，请另取文件名。');
      let bytes;
      if (input.format === 'xlsx') bytes = exportWorkbook(plan);
      else if (input.format === 'pdf')
        bytes = await printDocument(plan, { print: false, authorize: () => guard(token) });
      else {
        const entries = plan.positions.map((p, i) => [
          `${String(i + 1).padStart(3, '0')}_${p.record.code.replace(/[^A-Za-z0-9_.-]/g, '_')}.png`,
          png(render.matrix(p.record.code)),
        ]);
        for (let i = 0; i < plan.pages; i++)
          entries.push([`标签页${i + 1}.svg`, render.pageSvg(plan, i)]);
        entries.push([
          '编号对应.json',
          JSON.stringify(
            { config: plan.config, records: plan.positions.map((p) => p.record) },
            null,
            2,
          ),
        ]);
        bytes = zip(entries);
      }
      guard(token);
      let handle;
      try {
        handle = await fs.open(file, 'wx');
        await handle.writeFile(bytes);
        await handle.sync();
      } catch (error) {
        if (error.code === 'EEXIST')
          throw new PlatformError(
            'LABEL_EXISTS',
            '文件已存在，请另取名称，标签导出不会覆盖原文件。',
          );
        throw error;
      } finally {
        await handle?.close();
      }
      guard(token);
      return {
        cancelled: false,
        fileName: path.basename(file),
        labels: plan.positions.length,
        pages: plan.pages,
      };
    },
  });
}
module.exports = { createLabelFiles };
