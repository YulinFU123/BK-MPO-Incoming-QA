'use strict';
/** Build export charts from a captured result, independently of the visible page. */
const DAILY_CHART_PAGE_SIZE = 25;
const DAILY_STATUS_LABELS = {
  'Rework,Scrap': '返修＋报废', Rework: '返修', Scrap: '报废',
  Release: '放行', 'Awaiting Disposition': '待处置', '': '全部报检记录',
};

function dailyChartDefinitions(result, query) {
  const charts = [{ title: '记录数量趋势（仅有记录周期）', rows: result.trend, trend: true }, ...result.charts];
  const order = query.chart_order || [];
  return charts.sort((a, b) => {
    const index = title => order.includes(title) ? order.indexOf(title) : 999;
    return index(a.title) - index(b.title);
  });
}

function chartRows(chart, query) {
  const top = chart.trend ? 0 : Number(query.top ?? 10);
  if (!top || chart.rows.length <= top) return chart.rows.slice();
  const remaining = chart.rows.slice(top);
  return [...chart.rows.slice(0, top), {
    name: `其他人员/项目（${remaining.length}项）`,
    qty: remaining.reduce((sum, row) => sum + row.qty, 0),
    share: remaining.every(row => row.share != null)
      ? remaining.reduce((sum, row) => sum + row.share, 0) : null,
  }];
}

function dailyChartPages(chart, result, query) {
  const rows = chartRows(chart, query);
  const count = Math.max(1, Math.ceil(rows.length / DAILY_CHART_PAGE_SIZE));
  const maximum = Math.max(1, ...rows.map(row => row.qty));
  return Array.from({ length: count }, (_, page) => {
    const selected = rows.slice(page * DAILY_CHART_PAGE_SIZE, (page + 1) * DAILY_CHART_PAGE_SIZE);
    const title = chart.title + (count > 1 ? ` · ${page + 1}/${count}` : '');
    return { title, svg: dailyChartSvg(title, selected, result, query, maximum, chart.trend) };
  });
}

function dailyChartSvg(title, rows, result, query, maximum, trend) {
  const height = Math.max(260, 195 + rows.length * 50);
  const svg = svgEl('svg', {
    viewBox: `0 0 1200 ${height}`, width: 1200, height,
    role: 'img', 'aria-label': title,
    style: 'max-width:100%;height:auto;background:white;font-family:Arial,Microsoft YaHei,sans-serif',
  });
  const text = (x, y, size, value, color = '#243c50') =>
    svgEl('text', { x, y, 'font-size': size, fill: color }, value);
  svg.append(svgEl('rect', { width: 1200, height, fill: 'white' }), text(30, 35, 22, title));
  const scope = String(query.scope || '未指定范围');
  svg.append(text(30, 63, 15,
    `${result.start} 至 ${result.end} ｜ ${scope.slice(0, 40)} ｜ ${DAILY_STATUS_LABELS[query.status] || '全部报检记录'}`));
  const brief = [
    `楼层：${query.floor?.join('、') || '全部'}`, `产品：${query.product?.join('、') || '全部'}`,
    `人员：${query.employees?.length ? `指定${query.employees.length}人` : '全部'}`,
    `排除${query.exclude?.length || 0}人`, `报检班别：${query.shift?.join('、') || '全部'}`,
  ].join(' ｜ ');
  svg.append(text(30, 88, 14, brief.length > 100 ? brief.slice(0, 100) + '…（完整条件见快照）' : brief));
  if (!rows.length) svg.append(text(30, 145, 18, '当前筛选无记录；不代表未导入日期为零。'));
  rows.forEach((row, index) => {
    const y = 112 + index * 50;
    const name = String(row.name);
    svg.append(text(30, y + 17, 16, name.slice(0, 21)));
    if (name.length > 21) svg.append(text(30, y + 36, 14, name.slice(21, 44) + (name.length > 44 ? '…' : '')));
    svg.append(svgEl('rect', { x: 385, y, width: row.qty / maximum * 545, height: 28, rx: 4, fill: '#187e91' }));
    svg.append(text(950, y + 20, 16, `${fmt(row.qty)}${row.share == null ? '' : ' ｜ ' + (row.share * 100).toFixed(1) + '%'}`));
  });
  const denominator = trend ? '趋势数量按周期汇总；缺失日期不补零，周/月可能不完整。'
    : title.includes('工序全部人员') ? '占比分母：相同条件下该工序全部责任人员数量，包含未填写责任人。'
    : '占比分母：当前筛选记录数量合计；TOP和分页均不改变分母。';
  svg.append(text(30, height - 43, 13, denominator, '#617481'));
  svg.append(text(30, height - 20, 13, '数量按Sum of Qty汇总；非产品去重数、不良率或责任班别。完整名称及来源见Excel和统计快照。', '#617481'));
  return svg;
}

async function dpng(svg) {
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('图片转换超时')), 15000);
      image.onload = () => { clearTimeout(timer); resolve(); };
      image.onerror = () => { clearTimeout(timer); reject(new Error('浏览器无法读取图表')); };
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Number(svg.getAttribute('width')) * 2;
    canvas.height = Number(svg.getAttribute('height')) * 2;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器不支持图片转换');
    context.scale(2, 2);
    context.drawImage(image, 0, 0);
    const encoded = canvas.toDataURL('image/png');
    if (!encoded.startsWith('data:image/png;base64,')) throw new Error('图片为空或超过浏览器限制');
    return encoded;
  } finally {
    URL.revokeObjectURL(url);
  }
}
