#!/usr/bin/env bun
/**
 * CLI: discover which language versions of a Wikipedia article exist.
 *
 * Does not analyze pageviews, does not ask the user anything, does not
 * substitute a different article/language for one that isn't found —
 * it only reports what exists so the calling agent can decide.
 *
 * Usage:
 *   bun scripts/get-language-links.js --article "intermittent fasting" [--languages pl,cs] [--source-language en] [--pretty]
 *
 * Output (stdout, JSON):
 *   {
 *     "article": { "exists": true, "title": "Intermittent fasting" },
 *     "languages": {
 *       "pl": { "exists": true, "title": "Post przerywany" },
 *       "cs": { "exists": false }
 *     }
 *   }
 */

import {
  findArticle,
  getLanguageVersions,
  WikiRequestError,
} from "./lib/request.js";

function parseArgs(argv) {
  const args = { pretty: false, sourceLanguage: "en" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--article") args.article = argv[++i];
    else if (arg === "--languages") args.languages = argv[++i];
    else if (arg === "--source-language") args.sourceLanguage = argv[++i];
    else if (arg === "--pretty") args.pretty = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`Usage: get-language-links.js --article <title> [OPTIONS]

Discovers which language versions of a Wikipedia article exist.

Options:
  --article TITLE          Article title to look up (required)
  --languages CODES        Comma-separated language codes to check (e.g. pl,cs)
                            If omitted, returns every language version found.
  --source-language CODE   Wikipedia edition to resolve the article on (default: en)
  --pretty                 Pretty-print JSON output

Examples:
  get-language-links.js --article "intermittent fasting"
  get-language-links.js --article "intermittent fasting" --languages pl,cs`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }
  if (!args.article) {
    console.error("Error: --article is required.\n");
    printHelp();
    process.exitCode = 2;
    return;
  }

  const article = await findArticle(args.article, {
    language: args.sourceLanguage,
  });

  if (!article.exists) {
    console.log(
      JSON.stringify(
        { article: { exists: false, title: args.article }, languages: {} },
        null,
        args.pretty ? 2 : undefined,
      ),
    );
    return;
  }

  const versions = await getLanguageVersions(article.key, {
    language: args.sourceLanguage,
  });
  const versionsByCode = new Map(versions.map((v) => [v.language, v]));
  versionsByCode.set(args.sourceLanguage, {
    language: args.sourceLanguage,
    title: article.title,
  });

  const requestedCodes = args.languages
    ? args.languages
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    : Array.from(versionsByCode.keys());

  const languages = {};
  for (const code of requestedCodes) {
    const version = versionsByCode.get(code);
    languages[code] = version
      ? { exists: true, title: version.title }
      : { exists: false };
  }

  console.log(
    JSON.stringify(
      { article: { exists: true, title: article.title }, languages },
      null,
      args.pretty ? 2 : undefined,
    ),
  );
}

main().catch((err) => {
  if (err instanceof WikiRequestError) {
    console.error(`API error: ${err.message}`);
    process.exit(1);
  }
  console.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
