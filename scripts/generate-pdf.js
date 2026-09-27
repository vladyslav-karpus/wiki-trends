#!/usr/bin/env bun
/**
 * CLI: generate the PDF report from already-calculated metrics and the
 * agent's analysis text. Contains no PDF-drawing logic itself — see
 * lib/pdf.js. All text is passed in by the caller so the report can be
 * produced in any language.
 *
 * Usage:
 *   bun scripts/generate-pdf.js --metrics-file metrics.json \
 *     --title "Звіт про тренди Вікіпедії" \
 *     --y-label "Перегляди" --x-label "Дата" \
 *     --analysis-file analysis.txt
 *
 * --metrics-file and --analysis-file accept "-" to read from stdin (only
 * one of the two may use stdin at a time).
 */

import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { generatePdf } from "./lib/pdf.js";

function parseArgs(argv) {
  const args = { yLabel: "Views", xLabel: "Date" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--metrics-file") args.metricsFile = argv[++i];
    else if (arg === "--analysis-file") args.analysisFile = argv[++i];
    else if (arg === "--analysis") args.analysis = argv[++i];
    else if (arg === "--title") args.title = argv[++i];
    else if (arg === "--y-label") args.yLabel = argv[++i];
    else if (arg === "--x-label") args.xLabel = argv[++i];
    else if (arg === "--output") args.output = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`Usage: generate-pdf.js [OPTIONS]

Generates the PDF report: title page, one pageview chart per analyzed
article/language, then the analysis text verbatim.

Options:
  --metrics-file PATH   Path to the JSON output of analyze-page-views.js, or "-" for stdin (required)
  --analysis-file PATH  Path to a text file with the full analysis, or "-" for stdin
  --analysis TEXT       Analysis text given directly (alternative to --analysis-file)
  --title TEXT          Report title, in the same language as the analysis (required)
  --y-label TEXT        Value-axis title, in the same language as the analysis (default: "Views")
  --x-label TEXT        Time-axis title, in the same language as the analysis (default: "Date")
  --output PATH         Output PDF path (default: wiki-trends-report_<timestamp>.pdf
                         in the current project's root directory)

Example:
  analyze-page-views.js --languages '{"en":"Intermittent fasting"}' > metrics.json
  generate-pdf.js --metrics-file metrics.json --title "Wiki Trends Report" \\
    --analysis "Views grew steadily over the period."`);
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

async function readFromFileOrStdin(path) {
  if (path === "-") return readStdin();
  return readFile(path, "utf8");
}

function defaultOutputPath() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  // Anchored to the caller's project root (cwd), not the skill's own directory.
  return resolvePath(process.cwd(), `wiki-trends-report_${timestamp}.pdf`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }
  if (!args.metricsFile) {
    console.error("Error: --metrics-file is required.\n");
    printHelp();
    process.exitCode = 2;
    return;
  }
  if (!args.analysisFile && !args.analysis) {
    console.error("Error: either --analysis-file or --analysis is required.\n");
    printHelp();
    process.exitCode = 2;
    return;
  }
  if (!args.title) {
    console.error("Error: --title is required.\n");
    printHelp();
    process.exitCode = 2;
    return;
  }

  const metricsRaw = await readFromFileOrStdin(args.metricsFile);
  let metrics;
  try {
    metrics = JSON.parse(metricsRaw);
  } catch (err) {
    console.error(
      `Error: --metrics-file must contain valid JSON. ${err.message}`,
    );
    process.exitCode = 2;
    return;
  }

  const analysisText =
    args.analysis ?? (await readFromFileOrStdin(args.analysisFile)).trim();
  const outputPath = args.output
    ? resolvePath(process.cwd(), args.output)
    : defaultOutputPath();

  const { outputPath: writtenPath } = await generatePdf({
    title: args.title,
    metrics,
    analysisText,
    outputPath,
    yLabel: args.yLabel,
    xLabel: args.xLabel,
  });
  console.log(JSON.stringify({ success: true, outputPath: writtenPath }));
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
