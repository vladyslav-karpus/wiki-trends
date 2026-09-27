# Report writing and PDF generation rules

Full rules for Step 3 (conclusion, console reply, and PDF) from `SKILL.md`. For what
the metrics behind the report mean, see `references/metrics.md`.

## Conclusion writing rules

Every statement must be based strictly on the metrics from Step 2.

Clearly separate three categories of statement:

- **Observed metric** — what the numbers show (e.g. "views grew by roughly 24% over
  the period").
- **Interpretation** — what that plausibly means about interest in the topic.
- **Hypothesis** — a possible but unconfirmed explanation for an anomaly or
  difference, explicitly labeled as a hypothesis.

Never claim that a pageview trend proves real-world demand, intent, or causation —
present it as evidence that may support a hypothesis, not as proof. Never fabricate an
explanation for an anomaly.

Never name a raw metric field or variable (`regressionSlopePercentOfMean`,
`coefficientOfVariation`, `zScore`, `totalChangePercent`, etc.) in the text the user
sees — always translate it into a plain-language statement backed by the actual number
(a percentage, a date, a magnitude). See `references/metrics.md` for what each field
means so you can phrase it in plain language correctly.

Write the conclusion in the same language the user wrote their prompt in.

## Response template

Per analyzed language:

```
### <Language / article>

**Trend:** direction and strength as a percentage.
**Anomalies:** dates and nature of spikes/drops in plain words, or "none".
**Seasonality:** seasonal or not, peak/low months; or that it isn't assessable, and why.
```

Then a **Conclusion**:

- **One language analyzed** — a short (2–4 sentence) synthesis of its trend +
  anomalies + seasonality.
- **Two or more languages** — a comparative conclusion: which is growing/declining
  fastest, whether anomalies coincide across languages (hinting at a shared external
  cause) or are language-specific, and how seasonality differs.

Write this text (per-language readout + conclusion) once and reuse it verbatim in both
places: the console/chat reply **and** the `--analysis` passed to `generate-pdf.js`.
Don't summarize or shorten it for the PDF.

## PDF generation

The PDF is: title page → one pageview chart per analyzed article/language → the Step 3
analysis text.

`generate-pdf.js` draws the charts from the metrics but does not generate any of its
own text — **every string you pass it must already be in the user's language**,
including `--title`, `--y-label`, and `--x-label`.

`--analysis` supports light Markdown (`# `/`## ` headings, `- `/`* ` bullets,
`**bold**`), rendered properly rather than shown as raw symbols — so you can pass the
same Markdown-formatted text you write in the chat reply as-is, no need to strip
formatting.

```bash
bun scripts/analyze-page-views.js --languages '{...}' --article-title "Intermittent fasting" > /tmp/wt-metrics.json
bun scripts/generate-pdf.js \
  --metrics-file /tmp/wt-metrics.json \
  --title "<report title, in the user's language>" \
  --y-label "<value-axis title, in the user's language, e.g. 'Views'>" \
  --x-label "<time-axis title, in the user's language, e.g. 'Date'>" \
  --analysis "<the exact Step 3 text>"
```

`--analysis-file` (or `-` for stdin) also works if the analysis is long — write it to
a file first rather than trying to cram it into a single shell argument.

By default the PDF is written to **the current project's root directory** (the user's
working directory, not the skill's own directory) as
`wiki-trends-report_<timestamp>.pdf` — leave `--output` unset unless the user asked
for a specific path/name. The generated PDF is a runtime output artifact — never
commit it (already covered by `wiki-trends-report_*.pdf` in `.gitignore`).

Tell the user where the PDF was written when done.
