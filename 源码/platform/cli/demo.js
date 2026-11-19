'use strict';
const { createPlatform } = require('../index');
const fixture = require('../fixtures/synthetic.json');

async function main() {
  const platform = await createPlatform(fixture);
  const preview = await platform.imports.previewRows(fixture);
  const commit = await platform.imports.commitPreview(preview.previewId);
  const duplicate = await platform.imports.commitPreview(preview.previewId);
  const report = await platform.analysis.overview({ start: '2026-10-26', end: '2026-10-26', datasetId: fixture.dataset.id });
  const missing = await platform.analysis.overview({ start: '2026-10-24', end: '2026-10-24', datasetId: fixture.dataset.id });
  console.log(JSON.stringify({
    mode: 'development', synthetic: true, notice: fixture.notice,
    capabilities: platform.capabilities,
    import: { first: commit.status, repeated: duplicate.status },
    observations: { records: report.observations.recordCount, uniqueSN: report.observations.uniqueSerialCount },
    quality: report.quality,
    comparison: report.comparison,
    noDataRate: missing.quality.rate
  }, null, 2));
}
main().catch(error => { console.error(JSON.stringify({ code: error.code || 'DEMO_FAILED', message: '开发演示未通过。' })); process.exitCode = 1; });
