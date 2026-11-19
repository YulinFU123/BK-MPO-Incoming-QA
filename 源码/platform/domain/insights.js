'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AnalysisInsights = api;
})(typeof window === 'object' ? window : null, () => {
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const format = (value) =>
    finite(value)
      ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
      : '—';
  const range = (start, end) => (start === end ? start : `${start} 至 ${end}`);
  function change(current, previous, unit) {
    const delta = current - previous;
    if (!delta) return `与前期持平，均为 ${format(current)} ${unit}。`;
    const direction = delta > 0 ? '增加' : '减少';
    const relative = previous === 0 ? null : delta / previous;
    return (
      `由 ${format(previous)} 变为 ${format(current)} ${unit}，${direction} ${format(Math.abs(delta))} ${unit}` +
      (relative === null
        ? '；基期为0，不计算增幅。'
        : `（${(Math.abs(relative) * 100).toFixed(1)}%）。`)
    );
  }
  function peak(periods, unit, metric) {
    const available = periods.filter((row) => finite(row.value));
    if (!available.length)
      return { id: 'peak', label: '最高区间', text: '当前范围没有可读的数据点。' };
    const maximum = Math.max(...available.map((row) => row.value));
    const winners = available.filter((row) => row.value === maximum);
    const names = winners
      .slice(0, 3)
      .map((row) => row.label)
      .join('、');
    return {
      id: 'peak',
      label: '最高区间',
      text:
        maximum === 0
          ? `有来源的数据点${metric}均为0。`
          : `${names}${winners.length > 3 ? `等 ${winners.length} 个区间` : ''}最高，为 ${format(maximum)} ${unit}${winners.some((row) => row.partial) ? '（包含部分周期）' : ''}。`,
      evidence: winners.slice(0, 20).map((row) => `${row.label}：${format(row.value)} ${unit}`),
      action: winners.length === 1 && maximum !== 0 ? winners[0].action : null,
    };
  }
  function finish(kind, scope, highlights, extra = {}) {
    return {
      kind,
      scope,
      highlights,
      ...extra,
      note: '根据当前已保存或已分析结果离线计算；统计来源不等于问题根因。',
    };
  }
  function quantity(report, { currentFacts = [], previousFacts = [], dimension = '' } = {}) {
    const q = report.quality,
      p = report.comparison?.previousQuality;
    const scope = range(q.scope.start, q.scope.end);
    const complete = (summary) =>
      !!summary?.trend?.length &&
      summary.trend.every((row) => row.factCount > 0 && finite(row.totals?.defectiveUnits));
    const comparable = report.comparison?.status === 'available' && complete(q) && complete(p);
    const current = q.totals?.defectiveUnits,
      previous = p?.totals?.defectiveUnits;
    const comparisonAvailable = comparable && finite(current) && finite(previous);
    const highlights = [
      {
        id: 'change',
        label: '与前期比较',
        text: comparisonAvailable
          ? change(current, previous, '件')
          : '当前或前期缺少日期/完整不良件数，暂不比较增减。',
        evidence: [
          `本期：${scope}；已记录 ${format(current)} 件`,
          report.comparison?.previous
            ? `前期：${range(report.comparison.previous.start, report.comparison.previous.end)}；已记录 ${format(previous)} 件`
            : '前期超出可支持范围',
        ],
        action: comparisonAvailable ? null : { kind: 'quality' },
      },
    ];
    if (comparisonAvailable && q.rate.status === 'available' && p.rate.status === 'available') {
      const points = (q.rate.value - p.rate.value) * 100;
      highlights[0].text += ` 不良率${points === 0 ? '持平' : `${points > 0 ? '上升' : '下降'} ${format(Math.abs(points))} 个百分点`}。`;
    }
    highlights.push(
      peak(
        q.trend.map((row) => ({
          label: row.date,
          value: row.factCount ? row.totals?.defectiveUnits : null,
          action: { kind: 'quantity-date', date: row.date },
        })),
        '件',
        '不良件数',
      ),
    );
    if (comparisonAvailable && dimension) {
      const groups = new Map();
      for (const [facts, key] of [
        [currentFacts, 'current'],
        [previousFacts, 'previous'],
      ])
        for (const fact of facts) {
          if (!finite(fact.measures.defectiveUnits) || !Object.hasOwn(fact.dimensions, dimension))
            continue;
          const label = fact.dimensions[dimension];
          if (!groups.has(label)) groups.set(label, { label, current: 0, previous: 0 });
          groups.get(label)[key] += fact.measures.defectiveUnits;
        }
      const increases = [...groups.values()]
        .map((row) => ({ ...row, delta: row.current - row.previous }))
        .filter((row) => row.delta > 0)
        .sort((a, b) => b.delta - a.delta || a.label.localeCompare(b.label));
      const first = increases[0];
      highlights.push(
        first
          ? {
              id: 'contribution',
              label: '主要增加来源',
              text: `按“${dimension === 'process' ? '工序' : dimension}”分组，${first.label || '未填写'}增加最多：${format(first.previous)} → ${format(first.current)} 件，增加 ${format(first.delta)} 件。`,
              evidence: [
                '采用与总量相同的数据集、日期和筛选；增加最多不代表净增量的全部，也不代表根因。',
              ],
              action: { kind: 'quantity-group', dimension, value: first.label },
            }
          : { id: 'contribution', label: '主要增加来源', text: '当前分组没有比前期增加的对象。' },
      );
    } else
      highlights.push({
        id: 'contribution',
        label: '主要增加来源',
        text: dimension ? '比较条件不完整，暂不归纳分类增量。' : '当前数据没有可分组的统计维度。',
      });
    return finish('quantity', scope, highlights, { comparisonAvailable });
  }
  function legacy(data) {
    const comparable = !!data.comparable;
    const current = data.completed?.length || 0,
      previous = data.previous?.length || 0;
    const highlights = [
      {
        id: 'change',
        label: '已登记记录变化',
        text: comparable
          ? change(current, previous, '条记录') +
            (data.invalid
              ? ` 已排除 ${format(data.invalid)} 条日期无效记录，只比较有效日期的已登记记录。`
              : '')
          : data.invalid
            ? `存在 ${format(data.invalid)} 条日期无效记录，暂不比较。`
            : '当前范围没有适合比较的完整前期。',
        evidence: [
          `显示范围：${range(data.start, data.end)}`,
          data.comparable
            ? `比较本期：${range(data.start, data.completeEnd)}${data.containsToday ? '；当日尚未结束，不参加前期比较' : ''}`
            : '本期没有完整可比日期或选择了全部范围',
          data.previousStart
            ? `比较前期：${range(data.previousStart, data.previousEnd)}`
            : '当前不计算前期',
        ],
      },
    ];
    highlights.push(
      peak(
        data.buckets.map((row) => ({
          label: range(row.start, row.end),
          value: row.count,
          partial: row.partial,
          action: { kind: 'legacy-period', start: row.start, end: row.end },
        })),
        '条记录',
        '已登记记录',
      ),
    );
    const increases = comparable
      ? (data.changes || [])
          .filter((row) => row.delta > 0)
          .slice()
          .sort((a, b) => b.delta - a.delta || a.key.localeCompare(b.key))
      : [];
    const first = increases[0];
    highlights.push(
      first
        ? {
            id: 'contribution',
            label: '主要增加来源',
            text: `${first.label}：${format(first.before)} → ${format(first.count)} 条，增加 ${format(first.delta)} 条。`,
            evidence: ['依据原“异常增减”表，同一日期与分类口径；当日未完成记录不参加比较。'],
          }
        : {
            id: 'contribution',
            label: '主要增加来源',
            text: comparable ? '没有比前期增加的异常分类。' : '比较条件不完整，暂不归纳分类增量。',
          },
    );
    return finish('observations', range(data.start, data.end), highlights, {
      comparisonAvailable: comparable,
    });
  }
  function bi(report) {
    if (!report || report.empty)
      return finish(
        'bi',
        '',
        [{ id: 'empty', label: '当前状态', text: report?.message || '尚无BI分析结果。' }],
        { comparisonAvailable: false },
      );
    const rows = report.periods || [],
      latest = rows.at(-1);
    const valid =
      latest &&
      latest.status === '完整记录日期' &&
      latest.source_days === latest.calendar_days &&
      finite(latest.quantity) &&
      finite(latest.previous) &&
      !report.bad_dates;
    const highlights = [
      {
        id: 'change',
        label: '最近周期变化',
        text: valid
          ? `${range(latest.start, latest.end)}：${change(latest.quantity, latest.previous, 'pcs')}`
          : `${latest ? range(latest.start, latest.end) + '：' : ''}日期有缺口、周期不完整或缺少可比前期，暂不比较。`,
        evidence: latest
          ? [
              `原期间表：本期 ${format(latest.quantity)} pcs；前期 ${format(latest.previous)} pcs；${latest.comparison}`,
              `来源 ${latest.source_days}/${latest.calendar_days} 天${report.bad_dates ? `；另有 ${format(report.bad_dates)} 行无效日期被排除` : ''}`,
            ]
          : [],
      },
    ];
    highlights.push(
      peak(
        rows.map((row) => ({
          label: range(row.start, row.end),
          value: row.quantity,
          partial: row.status !== '完整记录日期',
        })),
        'pcs',
        '不良记录数量',
      ),
    );
    const first = report.ranking?.[0];
    highlights.push(
      first
        ? {
            id: 'contribution',
            label: '当前范围主要来源',
            text: `${first.name}最多，共 ${format(first.quantity)} pcs，占当前筛选已记录数量 ${(first.share * 100).toFixed(1)}%。`,
            evidence: [
              `当前范围已记录合计 ${format(report.summary.quantity)} pcs；占比不是不良率。`,
            ],
            action: { kind: 'bi-group', key: first.key },
          }
        : { id: 'contribution', label: '当前范围主要来源', text: '当前筛选没有匹配对象。' },
    );
    return finish('bi', range(report.query.start, report.query.end), highlights, {
      comparisonAvailable: !!valid,
    });
  }
  return Object.freeze({ quantity, legacy, bi });
});
