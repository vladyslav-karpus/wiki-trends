# wiki-trends

An Agent Skill for analyzing Wikipedia pageview trends. It helps B2C product
founders decide which topic to invest in next and which languages to launch in,
grounded in [Wikimedia Pageviews API](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html)
data instead of guesswork.

Format: [Agent Skills](https://agentskills.io/specification) — this whole
repository is the skill's directory: `SKILL.md` plus its own code in
`scripts/`, reference material in `references/`, and tests in `tests/`.

## Example prompts

- "Compare the growth of interest in intermittent fasting on the Polish and
  Czech Wikipedia over the last two years."
- "We're thinking of adding an astronomy course. Is interest in this topic
  growing on Ukrainian Wikipedia, and how much can we trust that growth?"
- "Compare interest in learning English across a few language editions and
  prepare a short report on which audiences to investigate next."

## Execution algorithm

Every request runs through the same linear pipeline, defined step-by-step in
`SKILL.md`:

1. **Parse the prompt.** The agent reads the request and works out what's
   actually being asked: the topic/article, which language editions matter,
   and any period or comparison the user specified. No network calls yet —
   this is the agent deciding what to ask the scripts for.
2. **Resolve the article and its language versions** —
   `scripts/get-language-links.js`. Called once, on English Wikipedia, without
   restricting to specific languages, so it returns every language edition
   that exists for the topic in a single call. If the article doesn't exist,
   or a language the user asked for isn't in the returned map, the agent stops
   and asks the user — it never guesses a title or silently drops a language.
3. **Fetch pageviews and compute raw statistics per language** —
   `scripts/analyze-page-views.js`. Once every language/title pair is
   confirmed, this script fetches all of them concurrently from the Wikimedia
   Pageviews API (`scripts/lib/request.js`) over a period resolved by
   `scripts/lib/dates.js` (snapped to whole calendar months so no bucket is
   partial), and produces per-language descriptive statistics: count, total,
   mean, median, min/max, standard deviation.
4. **Compute metrics** on top of those statistics, in the same script call
   (`scripts/lib/metrics.js`): trend (three independent estimates), anomalies
   (rolling z-score), seasonality (monthly coefficient of variation), and,
   when 2+ languages are analyzed, a cross-language comparison (ranking by
   views/trend strength, shared anomaly dates). Still pure computation — no
   text is written at this point.
5. **Write the grounded conclusion.** The agent reads the metrics JSON from
   steps 3–4 and writes the analysis in the user's language, following the
   rules in `references/report-guide.md`: observed fact vs. interpretation vs.
   hypothesis, no raw field/variable names, no causal claims from correlation.
   This exact text is reused verbatim both in the chat reply and as input to
   the report.
6. **Generate the PDF report** — `scripts/generate-pdf.js` /
   `scripts/lib/pdf.js`. Takes the metrics already computed in step 4 plus the
   exact conclusion text from step 5 and renders a single PDF: a title page,
   one pageview chart per analyzed language (drawn with Chart.js), then the
   analysis text with light Markdown support (headings, bullets, bold).

Each step only consumes what the previous one produced — the agent never
invents data to skip a step, and no script ever writes prose or decides what
the numbers mean.

### Scripts

1. **`scripts/get-language-links.js`** — checks whether an article and its
   language versions exist. It never guesses a title and never substitutes a
   different language for one that's missing — a missing language is a real
   question for the user, not an excuse for its own heuristic.
2. **`scripts/analyze-page-views.js`** — fetches pageviews for every
   language/title concurrently and computes metrics
   (`scripts/lib/metrics.js`): descriptive statistics, trend, anomalies,
   seasonality, cross-language comparison.
3. **`scripts/generate-pdf.js`** — renders the PDF (`scripts/lib/pdf.js`) from
   metrics that are already computed plus the conclusion text the agent wrote
   in step 5 above. It doesn't decide or generate any text itself — every
   label and the analysis are passed in from outside, so the report can be
   produced in any language.

## Metrics (`scripts/lib/metrics.js`)

- **Trend** — three independent estimates at once: `totalChangePercent`
  (first point vs. last — sensitive to noise at the edges),
  `regressionSlopePercentOfMean` (linear regression slope, normalized to the
  mean — a more robust estimate), and `halfOverHalfChangePercent` (first half
  of the period vs. the second — a sanity check). If the first two disagree in
  sign, trust `halfOverHalfChangePercent`, since that means an edge point is an
  outlier.
- **Anomalies** — points that deviate from their local neighborhood window by
  more than 2 standard deviations (a rolling z-score rather than a global one,
  so local spikes get caught on top of a long-term trend).
- **Seasonality** — coefficient of variation of the monthly averages;
  applicable only at monthly granularity with ≥12 points covering all 12
  months — otherwise it honestly returns `applicable: false` instead of a
  made-up conclusion.
- **Language comparison** — ranking by total pageviews and by trend strength,
  plus anomaly dates that coincide across multiple languages at once (a hint
  of a shared external cause, not proof).

## Tests

```bash
bun test
```

## How this was verified during development

- Unit tests (`bun test`) for every computation module.
- Manual runs of all three scripts against the live Wikimedia API on real
  multi-language articles, with visual inspection of the generated PDF.
- Numbers and trends cross-checked against
  [Pageviews Analysis](https://pageviews.wmcloud.org/) (Wikimedia Cloud
  Services), an independent tool built on the same Pageviews API.

## Known limitations

- No caching of repeated requests within a conversation — a follow-up question
  about the same period re-fetches everything from the API.
- No retry/backoff for Wikimedia API rate limiting.

## Iterative development plan

- **Cross-request caching.** `.wiki-trends-cache/` is already in `.gitignore`;
  what's left is keying already-fetched pageviews by
  language+title+period+granularity so follow-up questions in the same
  conversation ("now add another language", "narrow the period") don't
  re-fetch from scratch.
- **Sharper metrics.** STL/seasonal decomposition instead of the
  coefficient-of-variation heuristic; changepoint detection instead of a
  rolling z-score; confidence intervals for the trend estimate.
- **Related-topic discovery.** Integrating Wikipedia's search/category API so
  the agent can suggest adjacent topics on its own — this directly answers the
  requirement to "explain which audiences/topics to investigate next."
