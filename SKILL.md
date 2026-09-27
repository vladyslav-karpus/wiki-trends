---
name: wiki-trends
description: Analyzes Wikipedia pageview trends — fetches pageview statistics for one or more articles or language editions, compares traffic over time, and surfaces spikes, drops, and seasonal patterns. Use when the user wants to analyze or compare Wikipedia pageviews across articles, languages, or time periods.
---

This skill uses three deterministic scripts (run with [Bun](https://bun.sh)) for data
fetching, metric calculation, and PDF generation. **You** are responsible for talking to
the user, deciding when you have enough information to continue, and writing the
interpretation/conclusion — the scripts never do that.

Run all four steps below for every analysis. Step 4 (the PDF) is not an optional extra
that only runs if the user explicitly asks for a report/file — it's the standard last
step that follows the conclusion automatically, every time.

## Available scripts

- **`scripts/get-language-links.js`** — checks whether an article and its requested
  language versions exist. No pageview analysis.
- **`scripts/analyze-page-views.js`** — fetches pageviews for one or more language
  versions concurrently and computes statistics/trend/seasonality/anomalies/comparison.
  No prose, no PDF.
- **`scripts/generate-pdf.js`** — renders the PDF report from metrics you already have
  plus the conclusion you write. Does not fetch data or decide anything.

Run all of them with `bun`, from the skill directory root. Add `--help` to any of them to
see their full flag list.

## Step 1 — Discover the article and its language versions

Identify the article/topic the user means. **Always make the first call on English
Wikipedia and without `--languages`**, so you get back every language version that
exists for the article in one request — do this even if the user only asked about one
or two specific languages, and even if the user's own prompt/article title is in another
language:

```bash
bun scripts/get-language-links.js --article "intermittent fasting"
```

- Output shape (abridged — a real response lists every existing language edition):
  ```json
  {
    "article": { "exists": true, "title": "Intermittent fasting" },
    "languages": {
      "en": { "exists": true, "title": "Intermittent fasting" },
      "cs": { "exists": true, "title": "Přerušovaný půst" },
      "de": { "exists": true, "title": "Intermittierendes Fasten" }
    }
  }
  ```
- `--languages pl,cs` (comma-separated codes) narrows the response to just those codes
  instead of returning everything — only use it for a second, follow-up lookup (e.g. after
  the user names a different language than what you first checked); never use it for the
  initial call.

Rules:

- **If `article.exists` is `false`** — tell the user the article could not be found and
  ask them to clarify the topic/title. Do not guess a different title yourself.
- **If the user named specific languages, check their codes against the full
  `languages` map you got back.** If one isn't present, tell the user that language
  edition doesn't exist for this article — and since you already have the full list,
  you can offer a couple of alternatives from it — then ask whether they want a
  different language. Do **not** silently substitute another language or drop it
  without asking.
- Both of the above must be real questions to the user, and you must wait for their
  answer before continuing. Reply in the same language the user wrote their prompt in.
- Only proceed to Step 2 once you have at least one confirmed article/language pair.

## Step 2 — Fetch pageviews and calculate metrics

Build a JSON object mapping each confirmed language code to its title in that language
(from Step 1's output — use `article.title` for the source language itself if you're
analyzing it too), and pass it to `analyze-page-views.js`:

```bash
bun scripts/analyze-page-views.js \
  --languages '{"en":"Intermittent fasting","cs":"Přerušovaný půst"}' \
  --article-title "Intermittent fasting" \
  --pretty
```

Useful flags (all optional, defaults shown):

- `--start` / `--end` — `YYYY-MM-DD`. Default: a 2-year window ending yesterday (or end
  of last month for monthly granularity, to avoid a partial current-month bucket). Only
  pass these if the user asked for a specific period.
- `--granularity` — `daily` or `monthly` (default `monthly`).
- `--access` — `all-access` (default), `desktop`, `mobile-app`, `mobile-web`.
- `--agent` — `user` (default, human traffic only), `all-agents`, `spider`, `bot`.

The script fetches all requested languages concurrently and returns:

```json
{
  "period": { "start": "2024-08-31", "end": "2026-08-31" },
  "languages": {
    "en": { "title": "...", "statistics": {}, "trend": {}, "seasonality": {}, "anomalies": [], "pageviews": [] },
    "cs": { "...": "..." }
  },
  "comparison": { "...": "..." }
}
```

Field notes:

- **`trend.direction`** / **`trend.totalChangePercent`** (first vs last point) /
  **`trend.regressionSlopePercentOfMean`** (overall strength, normalized) /
  **`trend.halfOverHalfChangePercent`** (first-half vs second-half average — a sanity
  check). **If `totalChangePercent` and `halfOverHalfChangePercent` disagree in sign,
  trust `direction`/`halfOverHalfChangePercent`** — it means the very first or last point
  is an outlier skewing the naive endpoint comparison.
- **`anomalies`** — `{ timestamp, value, zScore, type: "spike"|"drop" }`, points that
  deviate from their local neighborhood by more than 2 standard deviations.
- **`seasonality`** — `{ applicable, likelySeasonal, coefficientOfVariation, peakMonths,
  lowMonths, monthlyAverages }` when monthly with ≥12 points covering all 12 months;
  otherwise `{ applicable: false, reason }` — say seasonality can't be assessed rather
  than guessing.
- **`comparison`** (present when 2+ languages) — `rankedByTotalViews`,
  `rankedByTrendStrength`, `trendDirectionByLanguage`, and `sharedAnomalyDates` (anomalies
  landing on the same timestamp across languages — a hint, not proof, of a shared cause).

If the script errors (e.g. no pageview data for that title/period), tell the user and ask
if they'd like to try a different period or language — don't invent data.

## Step 3 — Write the conclusion

Base every statement strictly on the metrics from Step 2. Never show the user raw
field/variable names (`regressionSlopePercentOfMean`, `coefficientOfVariation`, `zScore`,
etc.) — translate each into a plain-language statement backed by the actual numbers
(percentages, dates, magnitudes) so the reasoning stays traceable.

Clearly separate:

- **Observed metrics** — what the numbers show (e.g. "views grew by roughly 24% over the
  period").
- **Interpretation** — what that plausibly means about interest in the topic.
- **Hypothesis** — a possible but unconfirmed explanation for an anomaly or difference,
  explicitly labeled as a hypothesis.

Never claim that a pageview trend proves real-world demand, intent, or causation — present
it as evidence that may support a hypothesis, not as proof. Never fabricate an explanation
for an anomaly.

Per language, cover:

- **Trend** — direction and strength with a percentage.
- **Anomalies** — dates and nature of spikes/drops in plain words, or "none" if empty.
- **Seasonality** — seasonal or not, peak/low months; or that it isn't assessable, and why.

Then a **Conclusion**:

- **One language analyzed** — a short (2–4 sentence) synthesis of its trend + anomalies +
  seasonality.
- **Two or more languages** — a comparative conclusion: which is growing/declining
  fastest, whether anomalies coincide across languages (hinting at a shared external
  cause) or are language-specific, and how seasonality differs.

Write this entire Step 3 output (per-language readout + conclusion) in the same language
the user wrote their prompt in. This is the text you both reply to the user with **and**
pass to Step 4 — write it once, reuse it verbatim in both places, don't summarize or
shorten it for the PDF.

## Step 4 — Generate the PDF

Do this right after Step 3, for every analysis, whether or not the user asked for a PDF —
delivering the conclusion means delivering it both in chat and as this PDF.

The PDF is: title page → one pageview chart per analyzed article/language → the Step 3
analysis text. `generate-pdf.js` draws the charts from the metrics but does not generate
any of its own text — **every string you pass it must already be in the user's language**,
including `--title`, `--y-label`, and `--x-label`.

`--analysis` supports light Markdown (`# `/`## ` headings, `- `/`* ` bullets, `**bold**`),
rendered properly rather than shown as raw symbols — so you can pass the same
Markdown-formatted text you write in the chat reply as-is, no need to strip formatting.

Save the Step 2 JSON output to a file (or pipe it directly), then:

```bash
bun scripts/analyze-page-views.js --languages '{...}' --article-title "Intermittent fasting" > /tmp/wt-metrics.json
bun scripts/generate-pdf.js \
  --metrics-file /tmp/wt-metrics.json \
  --title "<report title, in the user's language>" \
  --y-label "<value-axis title, in the user's language, e.g. 'Перегляди'>" \
  --x-label "<time-axis title, in the user's language, e.g. 'Дата'>" \
  --analysis "<the exact Step 3 text>"
```

`--analysis-file` (or `-` for stdin) also works if the analysis is long — write it to a
file first rather than trying to cram it into a single shell argument.

By default the PDF is written to **the current project's root directory** (the user's
working directory, not the skill's own directory) as `wiki-trends-report_<timestamp>.pdf`
— leave `--output` unset unless the user asked for a specific path/name. The generated
PDF is a runtime output artifact — never commit it (already covered by
`wiki-trends-report_*.pdf` in `.gitignore`).

Tell the user where the PDF was written when done.
