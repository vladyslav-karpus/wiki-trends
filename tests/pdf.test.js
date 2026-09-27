import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..");

function metricsFixture(overrides = {}) {
  return {
    period: { start: "2024-01-01", end: "2024-03-01" },
    languages: {
      en: {
        title: "Intermittent fasting",
        pageviews: [
          { timestamp: "20240101", views: 100 },
          { timestamp: "20240201", views: 150 },
          { timestamp: "20240301", views: 90 },
        ],
      },
    },
    ...overrides,
  };
}

let dirsToClean = [];

async function withTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "wiki-trends-pdf-test-"));
  dirsToClean.push(dir);
  return dir;
}

async function writeMetricsFile(dir, metrics) {
  const path = join(dir, "metrics.json");
  await writeFile(path, JSON.stringify(metrics));
  return path;
}

function runGeneratePdf(args) {
  const result = Bun.spawnSync(["bun", "scripts/generate-pdf.js", ...args], {
    cwd: PROJECT_ROOT,
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString("utf8"),
    stderr: result.stderr.toString("utf8"),
  };
}

async function expectValidPdf(path) {
  const buffer = await readFile(path);
  expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  return buffer;
}

describe("generate-pdf.js", () => {
  test("writes a well-formed PDF and reports its path as JSON on stdout", async () => {
    const dir = await withTempDir();
    const metricsPath = await writeMetricsFile(dir, metricsFixture());
    const outputPath = join(dir, "report.pdf");

    const { exitCode, stdout } = runGeneratePdf([
      "--metrics-file",
      metricsPath,
      "--title",
      "Intermittent fasting — trends",
      "--y-label",
      "Views",
      "--x-label",
      "Date",
      "--analysis",
      "# Summary\n\nViews **grew** over the period.\n- point one\n- point two",
      "--output",
      outputPath,
    ]);

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ success: true, outputPath });
    const buffer = await expectValidPdf(outputPath);
    // A real report with a chart embedded is comfortably more than a few KB;
    // this guards against silently writing an empty/near-empty document.
    expect(buffer.length).toBeGreaterThan(5000);
  });

  test("creates missing parent directories for the output path", async () => {
    const dir = await withTempDir();
    const metricsPath = await writeMetricsFile(dir, metricsFixture());
    const outputPath = join(dir, "nested", "deeper", "report.pdf");

    const { exitCode } = runGeneratePdf([
      "--metrics-file",
      metricsPath,
      "--title",
      "Report",
      "--analysis",
      "Some analysis.",
      "--output",
      outputPath,
    ]);

    expect(exitCode).toBe(0);
    const info = await stat(outputPath);
    expect(info.isFile()).toBe(true);
  });

  test("renders one chart block per language without error", async () => {
    const dir = await withTempDir();
    const metrics = metricsFixture({
      languages: {
        en: {
          title: "Intermittent fasting",
          pageviews: Array.from({ length: 24 }, (_, i) => ({
            timestamp: `2024${String((i % 12) + 1).padStart(2, "0")}01`,
            views: 100 + i,
          })),
        },
        cs: {
          title: "Přerušovaný půst",
          pageviews: [
            { timestamp: "20240101", views: 10 },
            { timestamp: "20240201", views: 20 },
          ],
        },
      },
    });
    const metricsPath = await writeMetricsFile(dir, metrics);
    const outputPath = join(dir, "report.pdf");

    const { exitCode } = runGeneratePdf([
      "--metrics-file",
      metricsPath,
      "--title",
      "Multi-language report",
      "--y-label",
      "Перегляди",
      "--x-label",
      "Дата",
      "--analysis",
      "## Conclusion\nBoth editions grew.",
      "--output",
      outputPath,
    ]);

    expect(exitCode).toBe(0);
    await expectValidPdf(outputPath);
  });

  test("a language with fewer than 2 points renders a placeholder instead of failing", async () => {
    const dir = await withTempDir();
    const metrics = metricsFixture({
      languages: {
        en: {
          title: "Only one point",
          pageviews: [{ timestamp: "20240101", views: 5 }],
        },
      },
    });
    const metricsPath = await writeMetricsFile(dir, metrics);
    const outputPath = join(dir, "report.pdf");

    const { exitCode, stderr } = runGeneratePdf([
      "--metrics-file",
      metricsPath,
      "--title",
      "Sparse report",
      "--analysis",
      "Not enough data.",
      "--output",
      outputPath,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    await expectValidPdf(outputPath);
  });

  test("non-Latin analysis text (Cyrillic) round-trips into the PDF without failing", async () => {
    const dir = await withTempDir();
    const metricsPath = await writeMetricsFile(dir, metricsFixture());
    const outputPath = join(dir, "report.pdf");

    const { exitCode } = runGeneratePdf([
      "--metrics-file",
      metricsPath,
      "--title",
      "Тренди переглядів",
      "--y-label",
      "Перегляди",
      "--x-label",
      "Дата",
      "--analysis",
      "**Висновок:** перегляди зросли на 24% за період.",
      "--output",
      outputPath,
    ]);

    expect(exitCode).toBe(0);
    await expectValidPdf(outputPath);
  });

  test("--analysis-file is read from disk and used as the analysis text", async () => {
    const dir = await withTempDir();
    const metricsPath = await writeMetricsFile(dir, metricsFixture());
    const analysisPath = join(dir, "analysis.txt");
    await writeFile(analysisPath, "Analysis loaded from a file.");
    const outputPath = join(dir, "report.pdf");

    const { exitCode } = runGeneratePdf([
      "--metrics-file",
      metricsPath,
      "--title",
      "Report",
      "--analysis-file",
      analysisPath,
      "--output",
      outputPath,
    ]);

    expect(exitCode).toBe(0);
    await expectValidPdf(outputPath);
  });

  test("missing --metrics-file exits with an error and does not write a file", async () => {
    const { exitCode, stderr } = runGeneratePdf([
      "--title",
      "Report",
      "--analysis",
      "Some analysis.",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--metrics-file is required");
  });

  test("missing --title exits with an error", async () => {
    const dir = await withTempDir();
    const metricsPath = await writeMetricsFile(dir, metricsFixture());
    const { exitCode, stderr } = runGeneratePdf([
      "--metrics-file",
      metricsPath,
      "--analysis",
      "Some analysis.",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--title is required");
  });

  test("missing both --analysis and --analysis-file exits with an error", async () => {
    const dir = await withTempDir();
    const metricsPath = await writeMetricsFile(dir, metricsFixture());
    const { exitCode, stderr } = runGeneratePdf([
      "--metrics-file",
      metricsPath,
      "--title",
      "Report",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--analysis-file or --analysis is required");
  });

  test("malformed metrics JSON exits with a descriptive error", async () => {
    const dir = await withTempDir();
    const metricsPath = join(dir, "metrics.json");
    await writeFile(metricsPath, "{ not valid json");
    const { exitCode, stderr } = runGeneratePdf([
      "--metrics-file",
      metricsPath,
      "--title",
      "Report",
      "--analysis",
      "Some analysis.",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("must contain valid JSON");
  });
});

afterAll(async () => {
  await Promise.all(
    dirsToClean.map((d) => rm(d, { recursive: true, force: true })),
  );
});
