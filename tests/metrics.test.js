import { describe, expect, test } from "bun:test";
import {
  calculateStatistics,
  calculateTrend,
  compareLanguages,
  detectAnomalies,
  detectSeasonality,
} from "../scripts/lib/metrics.js";

function series(views, { start = "20240101" } = {}) {
  // One point per day starting at `start` (YYYYMMDD), just for a stable,
  // sortable timestamp — the functions under test never parse it as a date.
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(4, 6));
  const d = Number(start.slice(6, 8));
  const base = new Date(Date.UTC(y, m - 1, d));

  return views.map((v, i) => {
    const dt = new Date(base);
    dt.setUTCDate(dt.getUTCDate() + i);
    const ts = `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, "0")}${String(dt.getUTCDate()).padStart(2, "0")}`;
    return { timestamp: ts, views: v };
  });
}

function monthlySeries(
  monthlyViews,
  { startYear = 2024, startMonth = 1 } = {},
) {
  return monthlyViews.map((v, i) => {
    const y = startYear + Math.floor((startMonth - 1 + i) / 12);
    const m = ((startMonth - 1 + i) % 12) + 1;
    return { timestamp: `${y}${String(m).padStart(2, "0")}01`, views: v };
  });
}

describe("calculateStatistics", () => {
  test("computes count/total/mean/median/min/max/stdDev", () => {
    const stats = calculateStatistics(series([10, 20, 30, 40]));
    expect(stats).toEqual({
      count: 4,
      total: 100,
      mean: 25,
      median: 25,
      min: 10,
      max: 40,
      stdDev: Math.sqrt(125),
    });
  });

  test("median of an odd-length series is the middle value regardless of input order", () => {
    const stats = calculateStatistics(series([30, 10, 20]));
    expect(stats.median).toBe(20);
  });

  test("a single point has zero spread", () => {
    const stats = calculateStatistics(series([42]));
    expect(stats).toMatchObject({
      count: 1,
      total: 42,
      mean: 42,
      median: 42,
      stdDev: 0,
    });
  });

  test("all-zero series doesn't divide by zero", () => {
    const stats = calculateStatistics(series([0, 0, 0]));
    expect(stats).toMatchObject({ total: 0, mean: 0, stdDev: 0 });
  });
});

describe("calculateTrend", () => {
  test("strictly increasing series is reported as increasing with positive change", () => {
    const trend = calculateTrend(series([100, 150, 200, 250]));
    expect(trend.direction).toBe("increasing");
    expect(trend.totalChangePercent).toBeCloseTo(150, 5);
    expect(trend.regressionSlopePercentOfMean).toBeGreaterThan(0);
    expect(trend.halfOverHalfChangePercent).toBeGreaterThan(0);
  });

  test("strictly decreasing series is reported as decreasing with negative change", () => {
    const trend = calculateTrend(series([250, 200, 150, 100]));
    expect(trend.direction).toBe("decreasing");
    expect(trend.totalChangePercent).toBeCloseTo(-60, 5);
    expect(trend.regressionSlopePercentOfMean).toBeLessThan(0);
  });

  test("flat series has zero slope and zero change", () => {
    const trend = calculateTrend(series([50, 50, 50, 50]));
    expect(trend.direction).toBe("flat");
    expect(trend.totalChangePercent).toBe(0);
    expect(trend.regressionSlopePercentOfMean).toBe(0);
  });

  test("is order-independent — sorts by timestamp before computing", () => {
    const inOrder = calculateTrend(series([10, 20, 30]));
    const shuffled = calculateTrend([...series([10, 20, 30])].reverse());
    expect(shuffled).toEqual(inOrder);
  });

  test("a zero first point makes totalChangePercent null instead of Infinity", () => {
    const trend = calculateTrend(series([0, 10, 20]));
    expect(trend.totalChangePercent).toBeNull();
  });

  test("an all-zero series makes slopePercentOfMean null instead of NaN", () => {
    const trend = calculateTrend(series([0, 0, 0]));
    expect(trend.regressionSlopePercentOfMean).toBeNull();
  });

  test("a single point does not throw and reports a flat, unmeasurable trend", () => {
    const trend = calculateTrend(series([100]));
    expect(trend.direction).toBe("flat");
    expect(trend.totalChangePercent).toBe(0);
  });

  test("totalChangePercent and halfOverHalfChangePercent can disagree when an edge point is an outlier", () => {
    // First point is a spike; the rest of the series is flat/declining, so the
    // naive endpoint comparison (down) disagrees with the half-over-half one.
    const trend = calculateTrend(series([1000, 100, 100, 100, 90, 90]));
    expect(trend.totalChangePercent).toBeLessThan(0);
    expect(trend.direction).toBe("decreasing");
  });
});

describe("detectAnomalies", () => {
  test("finds no anomalies in a perfectly flat series", () => {
    const anomalies = detectAnomalies(series([10, 10, 10, 10, 10, 10, 10]));
    expect(anomalies).toEqual([]);
  });

  test("flags a huge spike against a mildly noisy baseline", () => {
    const anomalies = detectAnomalies(
      series([100, 102, 99, 101, 103, 500, 100, 102, 99, 101, 100]),
    );
    expect(anomalies).toContainEqual(
      expect.objectContaining({ value: 500, type: "spike" }),
    );
    const spike = anomalies.find((a) => a.value === 500);
    expect(spike.zScore).toBeGreaterThan(2);
  });

  test("flags a huge drop against a mildly noisy baseline", () => {
    const anomalies = detectAnomalies(
      series([100, 102, 99, 101, 103, 1, 100, 102, 99, 101, 100]),
    );
    expect(anomalies).toContainEqual(
      expect.objectContaining({ value: 1, type: "drop" }),
    );
    const drop = anomalies.find((a) => a.value === 1);
    expect(drop.zScore).toBeLessThan(-2);
  });

  test("a higher threshold keeps only the strongest anomaly", () => {
    const data = series([100, 102, 99, 101, 103, 1, 100, 102, 99, 101, 100]);
    const strict = detectAnomalies(data, { threshold: 3 });
    expect(strict).toHaveLength(1);
    expect(strict[0]).toMatchObject({ value: 1 });

    const lenient = detectAnomalies(data, { threshold: 1 });
    expect(lenient.length).toBeGreaterThan(strict.length);
  });

  test("a zero-variance neighborhood flags a differing point regardless of threshold, with a null zScore", () => {
    // All neighbors of the spike are identical (flat baseline), so localStd is
    // 0 — the point is flagged outright and `threshold` has no say in it.
    const data = series([5, 5, 5, 5, 999, 5, 5, 5, 5]);
    for (const threshold of [2, 1000]) {
      const anomalies = detectAnomalies(data, { threshold });
      expect(anomalies).toHaveLength(1);
      expect(anomalies[0]).toMatchObject({
        value: 999,
        type: "spike",
        zScore: null,
      });
    }
  });

  test("too few points for any window returns no anomalies instead of throwing", () => {
    expect(detectAnomalies(series([10]))).toEqual([]);
    expect(detectAnomalies(series([10, 500]))).toEqual([]);
  });

  test("sorts by timestamp before scanning, independent of input order", () => {
    const ordered = detectAnomalies(series([10, 10, 10, 500, 10, 10, 10]));
    const shuffled = detectAnomalies(
      [...series([10, 10, 10, 500, 10, 10, 10])].reverse(),
    );
    expect(shuffled).toEqual(ordered);
  });
});

describe("detectSeasonality", () => {
  test("fewer than 12 points is not applicable", () => {
    const result = detectSeasonality(monthlySeries([1, 2, 3]));
    expect(result).toEqual({
      applicable: false,
      reason: "requires at least 12 data points (got 3)",
    });
  });

  test("12+ points that don't cover all 12 distinct months is not applicable", () => {
    // 13 points but only January and February appear (daily granularity).
    const data = series(Array.from({ length: 13 }, () => 10));
    const result = detectSeasonality(data);
    expect(result.applicable).toBe(false);
    expect(result.reason).toContain("distinct months");
  });

  test("flags a strongly seasonal series with correct peak/low months", () => {
    // High in month 12, low in month 06, flat elsewhere.
    const views = [10, 10, 10, 10, 10, 100, 10, 10, 10, 10, 10, 1];
    const result = detectSeasonality(monthlySeries(views));
    expect(result.applicable).toBe(true);
    expect(result.likelySeasonal).toBe(true);
    expect(result.peakMonths).toEqual(["06"]);
    expect(result.lowMonths).toEqual(["12"]);
  });

  test("a flat series across all months is not seasonal", () => {
    const result = detectSeasonality(monthlySeries(Array(12).fill(50)));
    expect(result.applicable).toBe(true);
    expect(result.likelySeasonal).toBe(false);
    expect(result.coefficientOfVariation).toBe(0);
  });

  test("averages multiple years of the same month together", () => {
    // Two full years; month 03 is always double the rest.
    const views = Array.from({ length: 24 }, (_, i) =>
      i % 12 === 2 ? 200 : 100,
    );
    const result = detectSeasonality(monthlySeries(views));
    const march = result.monthlyAverages.find((m) => m.month === "03");
    expect(march.average).toBe(200);
    expect(march.samples).toBe(2);
    expect(result.peakMonths).toEqual(["03"]);
  });
});

describe("compareLanguages", () => {
  function metricsFor(language, { total, direction, slope, anomalies = [] }) {
    return {
      language,
      statistics: { total },
      trend: { direction, regressionSlopePercentOfMean: slope },
      anomalies,
    };
  }

  test("ranks languages by total views, descending", () => {
    const result = compareLanguages([
      metricsFor("en", { total: 100, direction: "flat", slope: 0 }),
      metricsFor("cs", { total: 500, direction: "flat", slope: 0 }),
      metricsFor("de", { total: 300, direction: "flat", slope: 0 }),
    ]);
    expect(result.rankedByTotalViews).toEqual(["cs", "de", "en"]);
    expect(result.totalViewsByLanguage).toEqual({ en: 100, cs: 500, de: 300 });
  });

  test("ranks languages by trend strength using absolute slope", () => {
    const result = compareLanguages([
      metricsFor("en", { total: 1, direction: "increasing", slope: 2 }),
      metricsFor("cs", { total: 1, direction: "decreasing", slope: -20 }),
      metricsFor("de", { total: 1, direction: "flat", slope: 0 }),
    ]);
    expect(result.rankedByTrendStrength).toEqual(["cs", "en", "de"]);
    expect(result.trendDirectionByLanguage).toEqual({
      en: "increasing",
      cs: "decreasing",
      de: "flat",
    });
  });

  test("a null slope (all-zero series) sorts as zero strength, not last by NaN", () => {
    const result = compareLanguages([
      metricsFor("en", { total: 1, direction: "flat", slope: null }),
      metricsFor("cs", { total: 1, direction: "increasing", slope: 5 }),
    ]);
    expect(result.rankedByTrendStrength).toEqual(["cs", "en"]);
  });

  test("finds anomaly dates shared by two or more languages", () => {
    const result = compareLanguages([
      metricsFor("en", {
        total: 1,
        direction: "flat",
        slope: 0,
        anomalies: [{ timestamp: "20240601", type: "spike" }],
      }),
      metricsFor("cs", {
        total: 1,
        direction: "flat",
        slope: 0,
        anomalies: [{ timestamp: "20240601", type: "spike" }],
      }),
      metricsFor("de", {
        total: 1,
        direction: "flat",
        slope: 0,
        anomalies: [{ timestamp: "20240715", type: "drop" }],
      }),
    ]);
    expect(result.sharedAnomalyDates).toEqual([
      {
        timestamp: "20240601",
        occurrences: [
          { language: "en", type: "spike" },
          { language: "cs", type: "spike" },
        ],
      },
    ]);
  });

  test("no shared dates when every language's anomalies land on different days", () => {
    const result = compareLanguages([
      metricsFor("en", {
        total: 1,
        direction: "flat",
        slope: 0,
        anomalies: [{ timestamp: "20240601", type: "spike" }],
      }),
      metricsFor("cs", {
        total: 1,
        direction: "flat",
        slope: 0,
        anomalies: [{ timestamp: "20240715", type: "drop" }],
      }),
    ]);
    expect(result.sharedAnomalyDates).toEqual([]);
  });
});
