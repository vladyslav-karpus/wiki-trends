#!/usr/bin/env bun
/**
 * CLI: fetch pageview data for one or more Wikipedia language versions of an
 * article and calculate metrics. Fetches languages concurrently. Does not
 * produce prose conclusions and does not generate a PDF.
 *
 * Usage:
 *   bun scripts/analyze-page-views.js --languages '{"pl":"Post przerywany","en":"Intermittent fasting"}' \
 *     [--start 2024-09-01] [--end 2026-09-01] [--granularity monthly] \
 *     [--access all-access] [--agent user] [--article-title "Intermittent fasting"] [--pretty]
 *
 * If --languages is omitted, a JSON object of the same shape (language code
 * -> title) is read from stdin — typically the `languages` map produced by
 * get-language-links.js, reduced to only the entries with exists: true.
 */

import { getPageviews, WikiRequestError } from "./lib/request.js";
import {
  calculateStatistics,
  calculateTrend,
  detectSeasonality,
  detectAnomalies,
  compareLanguages,
} from "./lib/metrics.js";

const ACCESS_VALUES = ["all-access", "desktop", "mobile-app", "mobile-web"];
const AGENT_VALUES = ["all-agents", "user", "spider", "bot"];
const GRANULARITY_VALUES = ["daily", "monthly"];

function parseArgs(argv) {
  const args = {
    access: "all-access",
    agent: "user",
    granularity: "monthly",
    pretty: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--languages") args.languages = argv[++i];
    else if (arg === "--article-title") args.articleTitle = argv[++i];
    else if (arg === "--start") args.start = argv[++i];
    else if (arg === "--end") args.end = argv[++i];
    else if (arg === "--granularity") args.granularity = argv[++i];
    else if (arg === "--access") args.access = argv[++i];
    else if (arg === "--agent") args.agent = argv[++i];
    else if (arg === "--pretty") args.pretty = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`Usage: analyze-page-views.js [OPTIONS]

Fetches pageview data for one or more language versions of an article and
calculates trend, seasonality, anomaly, and comparison metrics.

Options:
  --languages JSON          JSON object mapping language code -> title, e.g.
                             '{"pl":"Post przerywany","en":"Intermittent fasting"}'
                             If omitted, the same JSON shape is read from stdin.
  --article-title TITLE     Human-readable topic name to include in the output (optional)
  --start DATE               Period start, YYYY-MM-DD (default: 2 years before --end)
  --end DATE                  Period end, YYYY-MM-DD (default: yesterday)
  --granularity VALUE        daily | monthly (default: monthly)
  --access VALUE             all-access | desktop | mobile-app | mobile-web (default: all-access)
  --agent VALUE              all-agents | user | spider | bot (default: user)
  --pretty                   Pretty-print JSON output

Example:
  analyze-page-views.js --languages '{"en":"Intermittent fasting","pl":"Post przerywany"}'`);
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

function formatDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toApiDate(isoDate) {
  return isoDate.replaceAll("-", "");
}

function resolveDateRange({ start, end, granularity }) {
  let endDate = end ? new Date(`${end}T00:00:00Z`) : new Date();
  if (!end && granularity === "monthly") {
    // Avoid a partial current-month bucket by defaulting to end of last month.
    const firstOfThisMonth = new Date(
      Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1),
    );
    endDate = new Date(firstOfThisMonth.getTime() - 24 * 60 * 60 * 1000);
  } else if (!end) {
    endDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
  }

  let startDate;
  if (start) {
    startDate = new Date(`${start}T00:00:00Z`);
  } else {
    startDate = new Date(endDate);
    startDate.setUTCFullYear(startDate.getUTCFullYear() - 2);
  }

  return { start: formatDate(startDate), end: formatDate(endDate) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (!ACCESS_VALUES.includes(args.access)) {
    console.error(
      `Error: --access must be one of: ${ACCESS_VALUES.join(", ")}`,
    );
    process.exitCode = 2;
    return;
  }
  if (!AGENT_VALUES.includes(args.agent)) {
    console.error(`Error: --agent must be one of: ${AGENT_VALUES.join(", ")}`);
    process.exitCode = 2;
    return;
  }
  if (!GRANULARITY_VALUES.includes(args.granularity)) {
    console.error(
      `Error: --granularity must be one of: ${GRANULARITY_VALUES.join(", ")}`,
    );
    process.exitCode = 2;
    return;
  }

  let languagesRaw = args.languages;
  if (!languagesRaw) {
    languagesRaw = await readStdin();
  }
  if (!languagesRaw || !languagesRaw.trim()) {
    console.error(
      "Error: no --languages provided and stdin was empty. Expected a JSON object mapping language code -> title.",
    );
    process.exitCode = 2;
    return;
  }

  let languageMap;
  try {
    languageMap = JSON.parse(languagesRaw);
  } catch (err) {
    console.error(`Error: --languages must be valid JSON. ${err.message}`);
    process.exitCode = 2;
    return;
  }

  const entries = Object.entries(languageMap);
  if (entries.length === 0) {
    console.error(
      "Error: --languages JSON object must contain at least one language.",
    );
    process.exitCode = 2;
    return;
  }

  const period = resolveDateRange({
    start: args.start,
    end: args.end,
    granularity: args.granularity,
  });
  const startDate = toApiDate(period.start);
  const endDate = toApiDate(period.end);

  const results = await Promise.all(
    entries.map(([language, title]) =>
      getPageviews({
        language,
        title,
        startDate,
        endDate,
        access: args.access,
        agent: args.agent,
        granularity: args.granularity,
      }),
    ),
  );

  const languages = {};
  const metricsForComparison = [];
  for (const series of results) {
    const statistics = calculateStatistics(series.pageviews);
    const trend = calculateTrend(series.pageviews);
    const seasonality =
      args.granularity === "monthly"
        ? detectSeasonality(series.pageviews)
        : {
            applicable: false,
            reason: `requires monthly granularity (got ${args.granularity})`,
          };
    const anomalies = detectAnomalies(series.pageviews, {
      window: args.granularity === "daily" ? 7 : 5,
    });

    languages[series.language] = {
      title: series.title,
      statistics,
      trend,
      seasonality,
      anomalies,
      pageviews: series.pageviews,
    };
    metricsForComparison.push({
      language: series.language,
      statistics,
      trend,
      anomalies,
    });
  }

  const comparison =
    metricsForComparison.length > 1
      ? compareLanguages(metricsForComparison)
      : null;

  const output = {
    article: args.articleTitle ? { title: args.articleTitle } : undefined,
    period,
    languages,
    comparison,
  };

  console.log(JSON.stringify(output, null, args.pretty ? 2 : undefined));
}

main().catch((err) => {
  if (err instanceof WikiRequestError) {
    console.error(`API error: ${err.message}`);
    process.exit(1);
  }
  console.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
