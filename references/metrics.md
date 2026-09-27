# Metrics field reference (`analyze-page-views.js`)

What every field returned by Step 2 (`scripts/analyze-page-views.js`) means and how to
read it.

## Response shape

```json
{
  "period": { "start": "2024-09-01", "end": "2026-08-31", "granularity": "monthly" },
  "languages": {
    "en": { "title": "...", "statistics": {}, "trend": {}, "seasonality": {}, "anomalies": [], "pageviews": [] },
    "cs": { "...": "..." }
  },
  "comparison": { "...": "..." }
}
```

## `period`

The window actually analysed. At monthly granularity it always covers whole calendar
months — the API counts only the days inside the requested range, so a mid-month bound
would return a month-labelled bucket holding a few days of views.

`adjustments` appears only when a requested bound had to be moved (mid-month bound, or
an end inside the unfinished current month). When present, tell the user which window
was analysed instead of the one they asked for.

## `trend`

- **`direction`** — the overall trend direction.
- **`totalChangePercent`** — % change between the first and last point of the series.
  Simple but noise-sensitive: if the first or last point is a random outlier, this
  metric is misleading.
- **`regressionSlopePercentOfMean`** — linear regression (OLS) slope, normalized to the
  mean. Overall trend strength across the whole period.
- **`halfOverHalfChangePercent`** — comparison of the first-half vs. second-half
  average. A sanity check for `totalChangePercent`.

**If `totalChangePercent` and `halfOverHalfChangePercent` disagree in sign, trust
`direction`/`halfOverHalfChangePercent`** — it means the very first or last point is an
outlier skewing the naive endpoint comparison.

## `anomalies`

An array of `{ timestamp, value, zScore, type: "spike"|"drop" }` — points that deviate
from their local neighborhood by more than 2 standard deviations.

## `seasonality`

- When applicable (monthly granularity, ≥12 points, all 12 months covered):
  `{ applicable: true, likelySeasonal, coefficientOfVariation, peakMonths, lowMonths,
  monthlyAverages }`.
- When not: `{ applicable: false, reason }` — in that case tell the user seasonality
  can't be assessed rather than guessing.

## `comparison`

Present only when 2+ languages are analyzed:

- **`rankedByTotalViews`** — languages ranked by total pageviews.
- **`rankedByTrendStrength`** — languages ranked by trend strength (`|slope|`).
- **`trendDirectionByLanguage`** — trend direction per language.
- **`sharedAnomalyDates`** — anomalies landing on the same date across languages — a
  hint, not proof, of a shared cause.

## General rule

Never show the user raw field/variable names (`regressionSlopePercentOfMean`,
`coefficientOfVariation`, `zScore`, etc.) — translate each into a plain-language
statement backed by the actual numbers (percentages, dates, magnitudes) so the reasoning
stays traceable.
