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

## Step 3: Analyze trend, anomalies, and seasonality

Repeat Steps 1–2 once per language/article the user asked about, then run each result through the analysis script — don't compute these numbers yourself, the script's arithmetic is the source of truth:

```bash
node scripts/get_pageviews.js "<article key>" --lang <code> | node scripts/analyze_pageviews.js
```

It returns:

- **`trend`** — `direction` (up/down/flat), `totalChangePct` (first vs last point), `regressionSlopePctOfMean` (overall trend strength, normalized), `halfOverHalfChangePct` (first-half vs second-half average, a sanity check against a trend driven by one outlier). **If `totalChangePct` and `halfOverHalfChangePct` disagree in sign, trust `direction`/`halfOverHalfChangePct`** — it means the very first or last data point is an outlier (e.g. a partial month) skewing the naive endpoint comparison; mention this in your conclusion instead of reporting the misleading raw endpoint change.
- **`anomalies`** — array of `{ timestamp, value, zScore, type: "spike"|"drop" }`, points that deviate from their local neighborhood by more than 2 standard deviations.
- **`seasonality`** — `{ applicable, likelySeasonal, coefficientOfVariation, peakMonths, lowMonths, monthlyAverages }` when granularity is monthly with ≥12 data points; otherwise `{ applicable: false, reason }` — in that case, just say seasonality can't be assessed for this range/granularity rather than guessing.

Turn these numbers into a plain-language conclusion covering all three (trend, anomalies, seasonality) for each language analyzed.

## Step 4: Compare across languages (only if the user asked about 2+ languages/countries)

If only one language was requested, skip this step — there's nothing to compare.

With 2 or more, after analyzing each individually:

- Rank them by trend strength/direction (which is growing fastest, which is declining).
- Note any anomalies that land on the same or nearby timestamps across multiple languages (a shared spike/drop suggests a common external cause, e.g. news event, rather than something language-specific).

This logic doesn't change based on how many languages were requested — 2, 3, or more are handled the same way.
