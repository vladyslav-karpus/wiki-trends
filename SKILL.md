---
name: wiki-trends
description: Analyzes Wikipedia pageview trends — fetches pageview statistics for one or more articles, compares traffic over time, and surfaces spikes, drops, and seasonal patterns. Use when the user wants to compare pageviews across articles or time periods.
---

## Step 1: Resolve the article and its language versions

1. **Identify the article** the user wants analyzed from their prompt, and determine its title on **English Wikipedia** (translate/normalize if the user asked in another language).

2. **Run the language-links script** with that English title:

   ```bash
   node scripts/get_language_links.js "<English article title>"
   ```

   Example:

   ```bash
   node scripts/get_language_links.js "Intermittent fasting"
   ```

   This queries the English Wikipedia REST API (`en.wikipedia.org`) and returns a JSON array of every language version the article has, e.g.:

   ```json
   [
     {
       "code": "uk",
       "name": "українська",
       "key": "Інтервальне_голодування",
       "title": "Інтервальне голодування"
     },
     {
       "code": "de",
       "name": "Deutsch",
       "key": "Intermittierendes_Fasten",
       "title": "Intermittierendes Fasten"
     }
   ]
   ```

   - `code` — the Wikipedia project/language code (used to build pageview API URLs like `https://wikimedia.org/api/rest_v1/metrics/pageviews/.../<code>.wikipedia/...`).
   - `title` — the human-readable title in that language.
   - Add `--pretty` for indented output when inspecting results manually.

3. **If the article doesn't exist at all** (no English Wikipedia article found — the script exits non-zero with an error on stderr; check the exit code before parsing stdout as JSON) — you MUST end your reply with an explicit question asking the user to try a different topic/title. Do not silently move on or guess a title yourself.

4. **If the article exists but has no version in the language the user asked about** (the requested language `code` is missing from the returned list) — you MUST end your reply with an explicit question: tell the user that language edition doesn't exist for this article, and ask whether they want to try a different language. Do not silently move on or guess.

Both of these MUST be actual questions, not just statements, and you must reply in the same language the user wrote their prompt in (match the user, don't default to English or Ukrainian). Wait for the user's answer before continuing.

## Step 2: Fetch pageview counts

Once you have the resolved article `key` and language `code` for the requested edition (from Step 1), fetch its pageview history:

```bash
node scripts/get_pageviews.js "<article key>" --lang <code> [--access <all-access|desktop|mobile-app|mobile-web>] [--agent <all-agents|user|spider|bot>] [--granularity <daily|monthly>] [--start YYYYMMDD] [--end YYYYMMDD]
```

Example:

```bash
node scripts/get_pageviews.js "Intermittent_fasting" --lang en
```

Parameter defaults — only pass a flag if the user explicitly specified that parameter, otherwise let the script default:

- `--lang` — the language `code` from Step 1 (defaults to `en` if omitted).
- `--access` — defaults to `all-access` (all platforms combined) unless the user asked for a specific one (desktop / mobile app / mobile web).
- `--agent` — defaults to `user` (human traffic only, excludes bots/spiders) unless the user asked otherwise.
- `--granularity` — defaults to `monthly` unless the user asked for daily data.
- `--start` / `--end` — default to a 2-year window ending today, unless the user gave a specific period.

The script returns a JSON array of `{ project, article, granularity, timestamp, access, agent, views }` objects, one per time bucket (`timestamp` format `YYYYMMDD00`).

If the script exits non-zero (no data for that article/period — e.g. the article didn't exist yet, or there's simply no traffic recorded), tell the user no pageview data was found for that range and ask if they'd like to try a different period.

## Step 3: Calculate metrics (trend, anomalies, seasonality)

Repeat Steps 1–2 once per language/article the user asked about, then run each result through the analysis script for every case before moving on — don't compute these numbers yourself, the script's arithmetic is the source of truth:

```bash
node scripts/get_pageviews.js "<article key>" --lang <code> | node scripts/analyze_pageviews.js
```

It returns:

- **`trend`** — `direction` (up/down/flat), `totalChangePct` (first vs last point), `regressionSlopePctOfMean` (overall trend strength, normalized), `halfOverHalfChangePct` (first-half vs second-half average, a sanity check against a trend driven by one outlier). **If `totalChangePct` and `halfOverHalfChangePct` disagree in sign, trust `direction`/`halfOverHalfChangePct`** — it means the very first or last data point is an outlier (e.g. a partial month) skewing the naive endpoint comparison.
- **`anomalies`** — array of `{ timestamp, value, zScore, type: "spike"|"drop" }`, points that deviate from their local neighborhood by more than 2 standard deviations.
- **`seasonality`** — `{ applicable, likelySeasonal, coefficientOfVariation, peakMonths, lowMonths, monthlyAverages }` when granularity is monthly with ≥12 data points; otherwise `{ applicable: false, reason }` — in that case, just say seasonality can't be assessed for this range/granularity rather than guessing.

## Step 4: Write the conclusion

Write the output in plain language, in the same language the user wrote their prompt in (same rule as Step 1 — don't default to English). **Never show the user raw field/variable names** (e.g. `regressionSlopePctOfMean`, `halfOverHalfChangePct`, `coefficientOfVariation`, `zScore`) — translate each metric into a clear plain-language statement backed by the actual numbers behind it (percentages, dates, magnitudes), so the reasoning stays traceable without exposing the JSON shape.

For each case (article/language) analyzed, give a clear per-case readout based on the metrics from Step 3, one line per category:

- **Trend** — direction and strength in plain words with a percentage (e.g. "views grew by roughly 24% over the period").
- **Anomalies** — dates and nature of spikes/drops in plain words (e.g. "in March 2025 there was a sharp spike, several times above the usual level"); if there are none, say so.
- **Seasonality** — whether it's seasonal, which months are peak/low; if it can't be assessed (too little data or non-monthly granularity), say so directly instead of guessing.

Then write the final **Conclusion:**

- **Only one case analyzed** — a conclusion for that single case: a short (2–4 sentence) but clear summary that synthesizes its trend + anomalies + seasonality into one picture.
- **Two or more cases analyzed** — a comparative conclusion between the cases: which one is growing/declining fastest, whether anomalies coincide in time across cases (hinting at a shared external cause, e.g. a news event) or are case-specific, and how seasonality differs between them. This works the same way regardless of whether 2, 3, or more cases were analyzed.

Every statement, in the per-case readout and in the Conclusion, must be grounded in the actual numbers from Step 3 (percentages, dates, magnitude of deviation) — never a vague phrase like "seems to have grown a bit."
