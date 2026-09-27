/**
 * PDF report generation. Receives already-prepared metrics, chart labels,
 * and the agent's analysis text; does not fetch data, compute metrics, or
 * decide the analysis. All text content is passed in by the caller so the
 * report can be produced in any language.
 */

import PDFDocument from "pdfkit@0.15.2";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas@0.1.53";
import { Chart, registerables } from "chart.js@4.4.4";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

Chart.register(...registerables);

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
// Analysis text and chart labels can be in any language (e.g. Ukrainian), so
// PDFKit's built-in Helvetica (WinAnsi-only) and Chart.js/canvas's default
// font can't be used — both silently mangle non-Latin glyphs. DejaVu Sans
// covers Latin/Cyrillic/Greek and is registered with both renderers below.
const FONT_REGULAR = join(LIB_DIR, "fonts", "DejaVuSans.ttf");
const FONT_BOLD = join(LIB_DIR, "fonts", "DejaVuSans-Bold.ttf");
const CHART_FONT_FAMILY = "DejaVu Sans";
GlobalFonts.registerFromPath(FONT_REGULAR, CHART_FONT_FAMILY);

const PAGE_MARGIN = 50;
const COLORS = {
  heading: "#111827",
  body: "#374151",
  muted: "#6b7280",
  accent: "#2563eb",
  grid: "#e5e7eb",
};

const BODY_SIZE = 11;
const CAPTION_SIZE = 12;

function formatDate(timestamp) {
  // timestamp is YYYYMMDD or YYYYMMDD00
  const y = timestamp.slice(0, 4);
  const m = timestamp.slice(4, 6);
  const d = timestamp.slice(6, 8);
  return d && d !== "00" ? `${y}-${m}-${d}` : `${y}-${m}`;
}

// Starts a new page only if the next block wouldn't fit in the space left
// on the current one — so content flows continuously instead of forcing a
// page break before every chart/section regardless of how much room is left.
function ensureSpace(doc, neededHeight) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + neededHeight > bottom) {
    doc.addPage();
  }
}

// Renders the pageview series as a PNG via Chart.js (axes, gridlines, ticks,
// and axis titles are all handled by Chart.js itself, at real pixel
// resolution — rendered at 2x the target point size for crisp embedding).
function renderChartPng(
  pageviews,
  { yLabel, xLabel, pixelWidth, pixelHeight },
) {
  const sorted = [...pageviews].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  const labels = sorted.map((p) => formatDate(p.timestamp));
  const values = sorted.map((p) => p.views);

  const canvas = createCanvas(pixelWidth, pixelHeight);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pixelWidth, pixelHeight);

  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          data: values,
          borderColor: COLORS.accent,
          backgroundColor: COLORS.accent,
          borderWidth: 2,
          pointRadius: sorted.length > 60 ? 0 : 2,
          fill: false,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: false,
      animation: false,
      devicePixelRatio: 1,
      font: { family: CHART_FONT_FAMILY },
      plugins: {
        legend: { display: false },
      },
      scales: {
        y: {
          beginAtZero: true,
          title: yLabel
            ? {
                display: true,
                text: yLabel,
                font: { family: CHART_FONT_FAMILY, size: 13 },
              }
            : undefined,
          ticks: { font: { family: CHART_FONT_FAMILY, size: 12 } },
          grid: { color: COLORS.grid },
        },
        x: {
          title: xLabel
            ? {
                display: true,
                text: xLabel,
                font: { family: CHART_FONT_FAMILY, size: 13 },
              }
            : undefined,
          ticks: {
            font: { family: CHART_FONT_FAMILY, size: 10 },
            autoSkip: false,
            maxRotation: 90,
            minRotation: 45,
          },
          grid: { display: false },
        },
      },
    },
  });

  const buffer = canvas.toBuffer("image/png");
  chart.destroy();
  return buffer;
}

function drawLineChart(
  doc,
  pageviews,
  { width, height, caption, yLabel, xLabel },
) {
  const startX = doc.x;

  if (caption) {
    doc
      .fontSize(CAPTION_SIZE)
      .font("Sans-Bold")
      .fillColor(COLORS.heading)
      .text(caption, startX, doc.y, { width });
    doc.font("Sans");
    doc.moveDown(0.3);
  }

  if (pageviews.length < 2) {
    doc.fontSize(BODY_SIZE).fillColor(COLORS.muted).text("—");
    doc.x = startX;
    return;
  }

  const scale = 2;
  const png = renderChartPng(pageviews, {
    yLabel,
    xLabel,
    pixelWidth: Math.round(width * scale),
    pixelHeight: Math.round(height * scale),
  });

  const imageY = doc.y;
  doc.image(png, startX, imageY, { width });
  doc.x = startX;
  doc.y = imageY + height;
}

// Renders a light subset of Markdown (headings via # / ##, bullets via - or *,
// and **bold** spans) using the flowing text API, so the analysis text the
// agent writes for chat also reads cleanly in the PDF instead of showing raw
// "**"/"-" characters.
function drawInlineMarkdown(doc, text) {
  const segments = text.split(/(\*\*[^*]+\*\*)/g).filter((s) => s.length > 0);
  if (segments.length === 0) {
    doc.text("");
    return;
  }
  segments.forEach((segment, i) => {
    const bold = /^\*\*[^*]+\*\*$/.test(segment);
    doc.font(bold ? "Sans-Bold" : "Sans");
    doc.text(bold ? segment.slice(2, -2) : segment, {
      continued: i < segments.length - 1,
    });
  });
  doc.font("Sans");
}

function drawAnalysisText(doc, text) {
  const startX = doc.x;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    doc.x = startX;

    if (line === "") {
      doc.moveDown(0.6);
      continue;
    }

    const headingMatch = line.match(/^#{1,6}\s+(.*)$/);
    if (headingMatch) {
      doc
        .fontSize(13)
        .font("Sans-Bold")
        .fillColor(COLORS.heading)
        .text(headingMatch[1]);
      doc.font("Sans").fillColor(COLORS.body);
      doc.moveDown(0.2);
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      doc.fontSize(BODY_SIZE).fillColor(COLORS.body);
      doc.text("•  ", { continued: true });
      drawInlineMarkdown(doc, bulletMatch[1]);
      continue;
    }

    doc.fontSize(BODY_SIZE).fillColor(COLORS.body);
    drawInlineMarkdown(doc, line);
  }
  doc.x = startX;
}

/**
 * Generates the PDF report: title page, one chart per analyzed case
 * (article/language), then the analysis text.
 *
 * @param {object} params
 * @param {string} params.title - report title, in the caller's language.
 * @param {{period: {start: string, end: string},
 *          languages: Record<string, {title?: string, pageviews: Array<{timestamp: string, views: number}>}>}} params.metrics
 * @param {string} params.analysisText - the full analysis/conclusion text (light Markdown supported).
 * @param {string} params.outputPath
 * @param {string} [params.yLabel] - value-axis title, in the caller's language.
 * @param {string} [params.xLabel] - time-axis title, in the caller's language.
 */
export async function generatePdf({
  title,
  metrics,
  analysisText,
  outputPath,
  yLabel,
  xLabel,
}) {
  await mkdir(dirname(outputPath), { recursive: true });

  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: "A4" });
  doc.registerFont("Sans", FONT_REGULAR);
  doc.registerFont("Sans-Bold", FONT_BOLD);
  doc.font("Sans");
  const stream = createWriteStream(outputPath);
  doc.pipe(stream);

  doc.fontSize(22).font("Sans-Bold").fillColor(COLORS.heading).text(title);
  doc.font("Sans");
  doc.moveDown(0.3);
  doc
    .fontSize(10)
    .fillColor(COLORS.muted)
    .text(`${metrics.period.start} — ${metrics.period.end}`);

  const chartWidth = doc.page.width - 2 * PAGE_MARGIN;
  const chartHeight = 250;
  // Chart height plus headroom for the caption line drawn above the plot.
  const chartBlockHeight = chartHeight + 30;

  doc.moveDown(1);
  for (const [language, data] of Object.entries(metrics.languages)) {
    ensureSpace(doc, chartBlockHeight);
    drawLineChart(doc, data.pageviews, {
      width: chartWidth,
      height: chartHeight,
      caption: data.title ? `${language} — ${data.title}` : language,
      yLabel,
      xLabel,
    });
    doc.moveDown(1);
  }

  ensureSpace(doc, 150);
  drawAnalysisText(doc, analysisText);

  doc.end();

  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return { outputPath };
}
