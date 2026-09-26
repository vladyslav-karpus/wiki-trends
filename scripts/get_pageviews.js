/**
 * CLI: fetch per-article pageview counts from the Wikimedia Pageviews API.
 *
 * @example
 * node get_pageviews.js "Intermittent_fasting" --lang uk --granularity daily --start 20240101 --end 20240201
 */

const ACCESS_VALUES = ["all-access", "desktop", "mobile-app", "mobile-web"];
const AGENT_VALUES = ["all-agents", "user", "spider", "bot"];
const GRANULARITY_VALUES = ["daily", "monthly"];

const USER_AGENT =
  process.env.WIKI_TRENDS_USER_AGENT ||
  "wiki-trends-skill/1.0 (Wikipedia pageview trends analysis)";

function formatDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function parseArgs(argv) {
  const args = {
    access: "all-access",
    agent: "user",
    granularity: "monthly",
    pretty: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--lang") args.lang = argv[++i];
    else if (arg === "--access") args.access = argv[++i];
    else if (arg === "--agent") args.agent = argv[++i];
    else if (arg === "--granularity") args.granularity = argv[++i];
    else if (arg === "--start") args.start = argv[++i];
    else if (arg === "--end") args.end = argv[++i];
    else if (arg === "--pretty") args.pretty = true;
    else positional.push(arg);
  }

  if (positional.length !== 1) {
    console.error(
      "Usage: get_pageviews.js <article> [--lang en] [--access all-access] [--agent user] " +
        "[--granularity monthly] [--start YYYYMMDD] [--end YYYYMMDD] [--pretty]",
    );
    process.exit(1);
  }
  args.article = positional[0];
  args.lang = args.lang || "en";

  if (!ACCESS_VALUES.includes(args.access)) {
    console.error(
      `Invalid --access '${args.access}'. Must be one of: ${ACCESS_VALUES.join(", ")}`,
    );
    process.exit(1);
  }
  if (!AGENT_VALUES.includes(args.agent)) {
    console.error(
      `Invalid --agent '${args.agent}'. Must be one of: ${AGENT_VALUES.join(", ")}`,
    );
    process.exit(1);
  }
  if (!GRANULARITY_VALUES.includes(args.granularity)) {
    console.error(
      `Invalid --granularity '${args.granularity}'. Must be one of: ${GRANULARITY_VALUES.join(", ")}`,
    );
    process.exit(1);
  }

  let defaultEndDate = new Date();
  if (args.granularity === "monthly") {
    const firstOfThisMonth = new Date(
      Date.UTC(
        defaultEndDate.getUTCFullYear(),
        defaultEndDate.getUTCMonth(),
        1,
      ),
    );
    defaultEndDate = new Date(firstOfThisMonth.getTime() - 24 * 60 * 60 * 1000);
  }
  const end = args.end || formatDate(defaultEndDate);
  let start = args.start;
  if (!start) {
    const endDate = new Date(
      Date.UTC(
        Number(end.slice(0, 4)),
        Number(end.slice(4, 6)) - 1,
        Number(end.slice(6, 8)),
      ),
    );
    endDate.setUTCFullYear(endDate.getUTCFullYear() - 2);
    start = formatDate(endDate);
  }
  args.start = start;
  args.end = end;

  return args;
}

async function fetchPageviews({
  lang,
  access,
  agent,
  article,
  granularity,
  start,
  end,
}) {
  const project = `${lang}.wikipedia`;
  const encodedArticle = encodeURIComponent(article.replace(/ /g, "_"));
  const url =
    `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${project}/${access}/${agent}/` +
    `${encodedArticle}/${granularity}/${start}/${end}`;
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    if (response.status === 404) {
      console.error(
        `No pageview data for '${article}' on ${project} between ${start} and ${end}`,
      );
    } else {
      console.error(`HTTP ${response.status} error fetching ${url}`);
    }
    process.exit(1);
  }
  return response.json();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const data = await fetchPageviews(args);
  console.log(JSON.stringify(data.items, null, args.pretty ? 2 : undefined));
}

main().catch((err) => {
  console.error(`Network error: ${err.message}`);
  process.exit(1);
});
