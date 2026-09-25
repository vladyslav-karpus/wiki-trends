/**
 * CLI: compute trend, anomalies, and seasonality metrics from a pageviews JSON series
 * (the output of get_pageviews.js).
 *
 * @example
 * node get_pageviews.js "Intermittent_fasting" | node analyze_pageviews.js --pretty
 * @example
 * node analyze_pageviews.js pageviews.json --window 5 --threshold 2
 */

function parseArgs(argv) {
  const args = { threshold: 2, pretty: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--window") args.window = Number(argv[++i]);
    else if (arg === "--threshold") args.threshold = Number(argv[++i]);
    else if (arg === "--pretty") args.pretty = true;
    else positional.push(arg);
  }
  args.file = positional[0];
  return args;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stddev(values) {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

function computeTrend(views) {
  const n = views.length;
  const first = views[0];
  const last = views[n - 1];
  const totalChangePct = first === 0 ? null : ((last - first) / first) * 100;

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
  const slopePctOfMean = yMean === 0 ? null : (slope / yMean) * 100;

  const half = Math.floor(n / 2);
  const firstHalfAvg = mean(views.slice(0, half || 1));
  const secondHalfAvg = mean(views.slice(n - (half || 1)));
  const halfOverHalfChangePct =
    firstHalfAvg === 0
      ? null
      : ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100;

  return {
    direction: slope > 0 ? "up" : slope < 0 ? "down" : "flat",
    totalChangePct,
    regressionSlopePerPeriod: slope,
    regressionSlopePctOfMean: slopePctOfMean,
    firstHalfAvg,
    secondHalfAvg,
    halfOverHalfChangePct,
  };
}

function computeAnomalies(items, views, window, threshold) {
  const n = views.length;
  const anomalies = [];
  const half = Math.floor(window / 2);

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
          timestamp: items[i].timestamp,
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
        timestamp: items[i].timestamp,
        value: views[i],
        zScore: Number(z.toFixed(2)),
        type: z > 0 ? "spike" : "drop",
      });
    }
  }

  return anomalies;
}

function computeSeasonality(items, views) {
  const granularity = items[0].granularity;
  if (granularity !== "monthly" || items.length < 12) {
    return {
      applicable: false,
      reason: `requires monthly granularity and >=12 data points (got ${granularity}, ${items.length} points)`,
    };
  }

  const byMonth = new Map();
  items.forEach((item, i) => {
    const month = item.timestamp.slice(4, 6);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(views[i]);
  });

  const monthlyAverages = Array.from(byMonth.entries())
    .map(([month, vals]) => ({ month, avg: mean(vals), samples: vals.length }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const avgs = monthlyAverages.map((m) => m.avg);
  const overallMean = mean(avgs);
  const coefficientOfVariation =
    overallMean === 0 ? 0 : stddev(avgs) / overallMean;

  const maxAvg = Math.max(...avgs);
  const minAvg = Math.min(...avgs);
  const peakMonths = monthlyAverages
    .filter((m) => m.avg === maxAvg)
    .map((m) => m.month);
  const lowMonths = monthlyAverages
    .filter((m) => m.avg === minAvg)
    .map((m) => m.month);

  return {
    applicable: true,
    likelySeasonal: coefficientOfVariation > 0.2,
    coefficientOfVariation: Number(coefficientOfVariation.toFixed(3)),
    peakMonths,
    lowMonths,
    monthlyAverages,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = args.file
    ? require("fs").readFileSync(args.file, "utf8")
    : await readStdin();
  const items = JSON.parse(raw);

  if (!Array.isArray(items) || items.length === 0) {
    console.error("Input must be a non-empty JSON array of pageview items");
    process.exit(1);
  }

  items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const views = items.map((item) => item.views);
  const window = args.window || (items[0].granularity === "daily" ? 7 : 5);

  const result = {
    project: items[0].project,
    article: items[0].article,
    period: {
      start: items[0].timestamp,
      end: items[items.length - 1].timestamp,
      points: items.length,
    },
    trend: computeTrend(views),
    anomalies: computeAnomalies(items, views, window, args.threshold),
    seasonality: computeSeasonality(items, views),
  };

  console.log(JSON.stringify(result, null, args.pretty ? 2 : undefined));
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
