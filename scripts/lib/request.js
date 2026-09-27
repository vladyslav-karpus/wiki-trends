/**
 * All Wikimedia network access lives here: finding articles, discovering
 * language versions, and fetching pageview series. No analysis or formatting.
 */

const USER_AGENT =
  process.env.WIKI_TRENDS_USER_AGENT ||
  "wiki-trends-skill/1.0 (Wikipedia pageview trends analysis)";

const ACCESS_VALUES = ["all-access", "desktop", "mobile-app", "mobile-web"];
const AGENT_VALUES = ["all-agents", "user", "spider", "bot"];
const GRANULARITY_VALUES = ["daily", "monthly"];

export class WikiRequestError extends Error {
  constructor(message, { status, url } = {}) {
    super(message);
    this.name = "WikiRequestError";
    this.status = status;
    this.url = url;
  }
}

function toUnderscoreTitle(title) {
  return title.trim().replace(/ /g, "_");
}

async function fetchJson(url) {
  let response;
  try {
    response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  } catch (err) {
    throw new WikiRequestError(
      `Network error fetching ${url}: ${err.message}`,
      {
        url,
      },
    );
  }
  if (!response.ok) {
    throw new WikiRequestError(`HTTP ${response.status} fetching ${url}`, {
      status: response.status,
      url,
    });
  }
  return response.json();
}

/**
 * Checks whether an article exists on a given Wikipedia language edition
 * and returns its canonical title.
 *
 * @returns {Promise<{language: string, title: string, exists: boolean, key?: string}>}
 */
export async function findArticle(title, { language = "en" } = {}) {
  const encoded = encodeURIComponent(toUnderscoreTitle(title));
  const url = `https://${language}.wikipedia.org/w/rest.php/v1/page/${encoded}`;
  try {
    const page = await fetchJson(url);
    return { language, title: page.title, exists: true, key: page.key };
  } catch (err) {
    if (err instanceof WikiRequestError && err.status === 404) {
      return { language, title, exists: false };
    }
    throw err;
  }
}

/**
 * Lists the other-language versions of an article that exists on `language`.
 *
 * @returns {Promise<Array<{language: string, title: string, key: string, name: string}>>}
 */
export async function getLanguageVersions(key, { language = "en" } = {}) {
  const encoded = encodeURIComponent(toUnderscoreTitle(key));
  const url = `https://${language}.wikipedia.org/w/rest.php/v1/page/${encoded}/links/language`;
  try {
    const links = await fetchJson(url);
    return links.map((link) => ({
      language: link.code,
      title: link.title,
      key: link.key,
      name: link.name,
    }));
  } catch (err) {
    if (err instanceof WikiRequestError && err.status === 404) {
      return [];
    }
    throw err;
  }
}

/**
 * Fetches per-article pageview counts from the Wikimedia Pageviews API.
 *
 * @returns {Promise<{language: string, title: string, pageviews: Array<{timestamp: string, views: number}>}>}
 */
export async function getPageviews({
  language,
  title,
  startDate,
  endDate,
  access = "all-access",
  agent = "user",
  granularity = "monthly",
}) {
  if (!ACCESS_VALUES.includes(access)) {
    throw new WikiRequestError(
      `Invalid access '${access}'. Must be one of: ${ACCESS_VALUES.join(", ")}`,
    );
  }
  if (!AGENT_VALUES.includes(agent)) {
    throw new WikiRequestError(
      `Invalid agent '${agent}'. Must be one of: ${AGENT_VALUES.join(", ")}`,
    );
  }
  if (!GRANULARITY_VALUES.includes(granularity)) {
    throw new WikiRequestError(
      `Invalid granularity '${granularity}'. Must be one of: ${GRANULARITY_VALUES.join(", ")}`,
    );
  }

  const project = `${language}.wikipedia`;
  const encoded = encodeURIComponent(toUnderscoreTitle(title));
  const url =
    `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${project}/${access}/${agent}/` +
    `${encoded}/${granularity}/${startDate}/${endDate}`;

  try {
    const data = await fetchJson(url);
    return {
      language,
      title,
      pageviews: data.items.map((item) => ({
        timestamp: item.timestamp,
        views: item.views,
      })),
    };
  } catch (err) {
    if (err instanceof WikiRequestError && err.status === 404) {
      throw new WikiRequestError(
        `No pageview data for '${title}' on ${project} between ${startDate} and ${endDate}`,
        { status: 404, url },
      );
    }
    throw err;
  }
}
