'use strict';

const { requireRepository } = require('../ports/contracts');
const { dateRange, shiftISODate } = require('../domain/validation');
const { summarizeObservations, summarizeQualityFacts } = require('../domain/metrics');
const { PlatformError } = require('../domain/errors');
const insights = require('../domain/insights');
const OBSERVATION_FIELDS = ['templateId', 'serialNumber', 'issue', 'relatedCode'];

const delta = (current, previous) => ({
  absolute: current - previous,
  relative: previous === 0 ? null : (current - previous) / previous,
});

function createAnalysisService({ repository }) {
  requireRepository(repository);
  return Object.freeze({
    async overview({ start, end, filters = {}, datasetId }) {
      const range = dateRange(start, end);
      let previousEnd, previousStart;
      try {
        previousEnd = shiftISODate(start, -1);
        previousStart = shiftISODate(start, -range.days);
      } catch (error) {
        if (!(error instanceof PlatformError) || error.code !== 'INVALID_DATE') throw error;
      }
      const snapshot = await repository.snapshot();
      const current = { start, end, filters, datasetId };
      const prior =
        previousStart && previousEnd
          ? { start: previousStart, end: previousEnd, filters, datasetId }
          : null;
      const observations = summarizeObservations(snapshot.observations, current);
      const quality = summarizeQualityFacts(snapshot.facts, current);
      const previousObservations = prior
        ? summarizeObservations(snapshot.observations, prior)
        : null;
      const previousQuality = prior ? summarizeQualityFacts(snapshot.facts, prior) : null;
      const observationScope = snapshot.observations.filter(
        (item) =>
          item.observedOn >= (previousStart || start) &&
          item.observedOn <= end &&
          Object.entries(filters)
            .filter(([field]) => OBSERVATION_FIELDS.includes(field))
            .every(([field, value]) => item[field] === value),
      );
      const unsupportedObservationFilters = Object.keys(filters).filter(
        (field) =>
          !OBSERVATION_FIELDS.includes(field) &&
          (observationScope.length === 0 ||
            observationScope.some((item) => !Object.hasOwn(item.dimensions || {}, field))),
      );
      const observationFilterSupported = unsupportedObservationFilters.length === 0;
      function withObservationStatus(summary) {
        if (observationFilterSupported) return { ...summary, status: 'available', reasons: [] };
        return {
          ...summary,
          status: 'unavailable',
          reasons: ['UNSUPPORTED_FILTER'],
          unsupportedFilters: unsupportedObservationFilters,
          recordCount: null,
          uniqueSerialCount: null,
          missingSerialCount: null,
          issues: [],
          trend: summary.trend.map((day) => ({
            ...day,
            recordCount: null,
            uniqueSerialCount: null,
            missingSerialCount: null,
          })),
        };
      }
      const report = {
        dateBasis: { observations: 'discovery-local-date', quality: 'bi-business-date' },
        observations: withObservationStatus(observations),
        quality,
        comparison: {
          status: prior ? 'available' : 'unavailable',
          reasons: prior ? [] : ['PREVIOUS_PERIOD_OUT_OF_RANGE'],
          previous: prior ? { start: previousStart, end: previousEnd } : null,
          recordCount:
            prior && observationFilterSupported
              ? delta(observations.recordCount, previousObservations.recordCount)
              : null,
          uniqueSerialCount:
            prior && observationFilterSupported
              ? delta(observations.uniqueSerialCount, previousObservations.uniqueSerialCount)
              : null,
          defectRatePercentagePoints:
            prior &&
            quality.rate.status === 'available' &&
            previousQuality.rate.status === 'available'
              ? Number(((quality.rate.value - previousQuality.rate.value) * 100).toFixed(10))
              : null,
          previousQuality,
        },
        storage: { kind: repository.kind, persistent: repository.persistent === true },
        legacyQuality: snapshot.legacyQuality || null,
        warnings: [
          ...(!repository.persistent ? ['DEVELOPMENT_MEMORY_ONLY'] : []),
          ...(!observationFilterSupported ? ['OBSERVATION_FILTER_UNSUPPORTED'] : []),
          'OBSERVATION_COUNTS_ARE_NOT_DEFECTIVE_UNITS',
        ],
      };
      const selectedFacts = (scope) =>
        snapshot.facts.filter(
          (item) =>
            item.datasetId === datasetId &&
            item.businessDate >= scope.start &&
            item.businessDate <= scope.end &&
            Object.entries(filters).every(
              ([field, value]) =>
                Object.hasOwn(item.dimensions, field) && item.dimensions[field] === value,
            ),
        );
      const dataset = snapshot.datasets.find((item) => item.id === datasetId);
      const dimension =
        ['process', 'model', 'materialLot', ...(dataset?.grainFields || [])].find((field) =>
          dataset?.grainFields.includes(field),
        ) || '';
      report.insights = insights.quantity(report, {
        currentFacts: selectedFacts(current),
        previousFacts: prior ? selectedFacts(prior) : [],
        dimension,
      });
      return report;
    },
  });
}

module.exports = { createAnalysisService };
