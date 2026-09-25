/**
 * CLI: fetch the list of language versions (project code + title) for an English Wikipedia article.
 *
 * @example
 * node get_language_links.js "Intermittent fasting" --pretty
 */

const SOURCE_LANG = "en";

const USER_AGENT =
  process.env.WIKI_TRENDS_USER_AGENT ||
  "wiki-trends-skill/1.0 (Wikipedia pageview trends analysis)";

function parseArgs(argv) {
  const args = { pretty: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--pretty") args.pretty = true;
    else positional.push(arg);
  }
  if (positional.length !== 1) {
    console.error("Usage: get_language_links.js <title> [--pretty]");
    process.exit(1);
  }
  args.title = positional[0];
  return args;
}

async function fetchLanguageLinks(title) {
  const encodedTitle = encodeURIComponent(title.replace(/ /g, "_"));
  const url = `https://${SOURCE_LANG}.wikipedia.org/w/rest.php/v1/page/${encodedTitle}/links/language`;
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    if (response.status === 404) {
      console.error(
        `Article '${title}' not found on ${SOURCE_LANG}.wikipedia.org`,
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
  const links = await fetchLanguageLinks(args.title);
  console.log(JSON.stringify(links, null, args.pretty ? 2 : undefined));
}

main().catch((err) => {
  console.error(`Network error: ${err.message}`);
  process.exit(1);
});
