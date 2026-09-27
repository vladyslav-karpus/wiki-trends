/**
 * Pure analysis functions over pageview series. No network access, no PDF
 * generation, no user interaction, no prose — deterministic structured
 * output only. Input series are arrays of { timestamp, views }.
 */

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function stddev(values) {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/**
 * Basic descriptive statistics for a pageview series.
 */
export function calculateStatistics(pageviews) {
  const views = pageviews.map((p) => p.views);
  return {
    count: views.length,
    total: views.reduce((sum, v) => sum + v, 0),
    mean: mean(views),
    median: median(views),
    min: Math.min(...views),
    max: Math.max(...views),
    stdDev: stddev(views),
  };
}

/**
 * Overall direction and strength of change across the series.
 */
export function calculateTrend(pageviews) {
  const sorted = [...pageviews].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  const views = sorted.map((p) => p.views);
  const n = views.length;

  const first = views[0];
  const last = views[n - 1];
  const totalChangePercent =
    first === 0 ? null : ((last - first) / first) * 100;

  const xs = views.map((_, i) => i);
  const xMean = mean(xs);
  const yMean = mean(views);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (views[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const slopePercentOfMean = yMean === 0 ? null : (slope / yMean) * 100;

  const half = Math.floor(n / 2) || 1;
  const firstHalfAverage = mean(views.slice(0, half));
  const secondHalfAverage = mean(views.slice(n - half));
  const halfOverHalfChangePercent =
    firstHalfAverage === 0
      ? null
      : ((secondHalfAverage - firstHalfAverage) / firstHalfAverage) * 100;

  return {
    direction: slope > 0 ? "increasing" : slope < 0 ? "decreasing" : "flat",
    totalChangePercent,
    regressionSlopePercentOfMean: slopePercentOfMean,
    firstHalfAverage,
    secondHalfAverage,
    halfOverHalfChangePercent,
  };
}

/**
 * Points that deviate from their local neighborhood by more than
 * `threshold` standard deviations.
 */
export function detectAnomalies(pageviews, { window, threshold = 2 } = {}) {
  const sorted = [...pageviews].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  const views = sorted.map((p) => p.views);
  const n = views.length;
  const win = window || 5;
  const half = Math.floor(win / 2);
  const anomalies = [];

  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    const neighborhood = views.slice(lo, hi).filter((_, idx) => lo + idx !== i);
    if (neighborhood.length < 2) continue;

    const localMean = mean(neighborhood);
    const localStd = stddev(neighborhood);
    if (localStd === 0) {
      if (views[i] !== localMean) {
        anomalies.push({
          timestamp: sorted[i].timestamp,
          value: views[i],
          zScore: null,
          type: views[i] > localMean ? "spike" : "drop",
        });
      }
      continue;
    }

    const z = (views[i] - localMean) / localStd;
    if (Math.abs(z) > threshold) {
      anomalies.push({
        timestamp: sorted[i].timestamp,
        value: views[i],
        zScore: Number(z.toFixed(2)),
        type: z > 0 ? "spike" : "drop",
      });
    }
  }

  return anomalies;
}

/**
 * Monthly seasonality. Requires monthly granularity and at least 12 points.
 */
export function detectSeasonality(pageviews) {
  if (pageviews.length < 12) {
    return {
      applicable: false,
      reason: `requires at least 12 data points (got ${pageviews.length})`,
    };
  }

  const byMonth = new Map();
  for (const { timestamp, views } of pageviews) {
    const month = timestamp.slice(4, 6);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(views);
  }

  if (byMonth.size < 12) {
    return {
      applicable: false,
      reason: `requires monthly granularity covering all 12 months (got ${byMonth.size} distinct months)`,
    };
  }

  const monthlyAverages = Array.from(byMonth.entries())
    .map(([month, vals]) => ({
      month,
      average: mean(vals),
      samples: vals.length,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const averages = monthlyAverages.map((m) => m.average);
  const overallMean = mean(averages);
  const coefficientOfVariation =
    overallMean === 0 ? 0 : stddev(averages) / overallMean;

  const maxAvg = Math.max(...averages);
  const minAvg = Math.min(...averages);

  return {
    applicable: true,
    likelySeasonal: coefficientOfVariation > 0.2,
    coefficientOfVariation: Number(coefficientOfVariation.toFixed(3)),
    peakMonths: monthlyAverages
      .filter((m) => m.average === maxAvg)
      .map((m) => m.month),
    lowMonths: monthlyAverages
      .filter((m) => m.average === minAvg)
      .map((m) => m.month),
    monthlyAverages,
  };
}

/**
 * Cross-language comparison over already-computed per-language metrics.
 * `languageMetrics` is an array of { language, statistics, trend, anomalies }.
 */
export function compareLanguages(languageMetrics) {
  const totalViewsByLanguage = {};
  const trendDirectionByLanguage = {};
  for (const { language, statistics, trend } of languageMetrics) {
    totalViewsByLanguage[language] = statistics.total;
    trendDirectionByLanguage[language] = trend.direction;
  }

  const rankedByTotalViews = [...languageMetrics]
    .sort((a, b) => b.statistics.total - a.statistics.total)
    .map((m) => m.language);

  const rankedByTrendStrength = [...languageMetrics]
    .sort(
      (a, b) =>
        Math.abs(b.trend.regressionSlopePercentOfMean ?? 0) -
        Math.abs(a.trend.regressionSlopePercentOfMean ?? 0),
    )
    .map((m) => m.language);

  // Group anomaly timestamps shared by two or more languages.
  const anomaliesByTimestamp = new Map();
  for (const { language, anomalies } of languageMetrics) {
    for (const anomaly of anomalies) {
      if (!anomaliesByTimestamp.has(anomaly.timestamp)) {
        anomaliesByTimestamp.set(anomaly.timestamp, []);
      }
      anomaliesByTimestamp
        .get(anomaly.timestamp)
        .push({ language, type: anomaly.type });
    }
  }
  const sharedAnomalyDates = Array.from(anomaliesByTimestamp.entries())
    .filter(([, occurrences]) => occurrences.length > 1)
    .map(([timestamp, occurrences]) => ({ timestamp, occurrences }));

  return {
    totalViewsByLanguage,
    trendDirectionByLanguage,
    rankedByTotalViews,
    rankedByTrendStrength,
    sharedAnomalyDates,
  };
}
