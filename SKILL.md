---
name: wiki-trends
description: Analyzes Wikipedia pageview trends — fetches pageview statistics for one or more articles or language editions, compares traffic over time, and surfaces spikes, drops, and seasonal patterns. Use when the user wants to analyze or compare Wikipedia pageviews across articles, languages, or time periods.
---

This skill uses three deterministic scripts (run with [Bun](https://bun.sh)) for data
fetching, metric calculation, and PDF generation. **You** are responsible for talking to
the user, deciding when you have enough information to continue, and writing the
interpretation/conclusion — the scripts never do that.

Run all three steps below for every analysis. The PDF in Step 3 is not an optional
extra that only runs if the user explicitly asks for a report/file — it's the standard
last step that follows the conclusion automatically, every time.

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

## Algorithm

1. **Discover the article and its language versions.** Call
   `bun scripts/get-language-links.js --article "<topic>"` on English Wikipedia,
   **without `--languages`**, even if the user asked about a specific language only —
   this is the only call that returns every existing language edition at once.
   - `article.exists: false` → tell the user, ask them to clarify. Never guess a title.
   - A user-named language missing from the returned `languages` map → tell them it
     doesn't exist for this article, offer alternatives from the map, ask what they
     want instead. Never silently substitute or drop a language.
   - Both of these are real questions — wait for the answer before continuing. Reply
     in the language the user wrote their prompt in.
2. **Fetch pageviews and compute metrics** for every confirmed language/title pair:
   ```bash
   bun scripts/analyze-page-views.js \
     --languages '{"en":"Intermittent fasting","cs":"Přerušovaný půst"}' \
     --article-title "Intermittent fasting" \
     --pretty
   ```
   Key flags (all optional): `--start`/`--end` (`YYYY-MM-DD`, default 2-year window
   ending yesterday — only set if the user asked for a specific period), `--granularity`
   (`daily`|`monthly`, default `monthly`), `--access` (default `all-access`), `--agent`
   (default `user`, human traffic only). See `references/metrics.md` for what every
   returned field (`trend`, `anomalies`, `seasonality`, `comparison`) means and how to
   read it correctly. If the script errors, tell the user and ask about a different
   period/language — don't invent data.
3. **Write the conclusion, print it, and generate the PDF from it** — one step, always
   done together, every time (not only if a PDF was asked for):
   - Write the conclusion based strictly on Step 2's metrics, in the user's language.
     Never name a raw metric field/variable (`regressionSlopePercentOfMean`,
     `coefficientOfVariation`, `zScore`, etc.) — always translate it into a
     plain-language statement backed by the actual number. Full rules (observed metric
     vs. interpretation vs. hypothesis, per-language coverage, single- vs.
     multi-language conclusion) and the response template are in
     `references/report-guide.md`.
   - Reply to the user in the console/chat with that exact text.
   - Pass that same exact text, verbatim, as `--analysis` to generate the PDF:
     ```bash
     bun scripts/analyze-page-views.js --languages '{...}' --article-title "..." > /tmp/wt-metrics.json
     bun scripts/generate-pdf.js \
       --metrics-file /tmp/wt-metrics.json \
       --title "<in the user's language>" \
       --y-label "<in the user's language>" \
       --x-label "<in the user's language>" \
       --analysis "<the exact conclusion text>"
     ```
     Full formatting/output rules are in `references/report-guide.md`. Tell the user
     where the PDF was written when done.
