import { afterEach, describe, expect, test } from "bun:test";
import {
  findArticle,
  getLanguageVersions,
  getPageviews,
  WikiRequestError,
} from "../scripts/lib/request.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return calls;
}

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("findArticle", () => {
  test("returns exists:true with the canonical title on success", async () => {
    const calls = mockFetch((url) => {
      expect(url).toContain("en.wikipedia.org");
      expect(url).toContain("Intermittent_fasting");
      return jsonResponse({ title: "Intermittent fasting", key: "Intermittent_fasting" });
    });

    const result = await findArticle("Intermittent fasting");
    expect(result).toEqual({
      language: "en",
      title: "Intermittent fasting",
      exists: true,
      key: "Intermittent_fasting",
    });
    expect(calls).toHaveLength(1);
  });

  test("returns exists:false on a 404 instead of throwing", async () => {
    mockFetch(() => jsonResponse({}, { status: 404 }));
    const result = await findArticle("Not A Real Article");
    expect(result).toEqual({
      language: "en",
      title: "Not A Real Article",
      exists: false,
    });
  });

  test("uses the requested language in the request URL", async () => {
    const calls = mockFetch((url) => {
      expect(url).toContain("cs.wikipedia.org");
      return jsonResponse({ title: "Přerušovaný půst", key: "Přerušovaný_půst" });
    });
    await findArticle("Přerušovaný půst", { language: "cs" });
    expect(calls[0].url).toContain("cs.wikipedia.org");
  });

  test("replaces spaces with underscores and URL-encodes the title", async () => {
    const calls = mockFetch(() =>
      jsonResponse({ title: "Some Article", key: "Some_Article" }),
    );
    await findArticle("Some Article");
    expect(calls[0].url).toContain("Some_Article");
    expect(calls[0].url).not.toContain("Some Article");
  });

  test("propagates a non-404 error instead of reporting the article missing", async () => {
    mockFetch(() => jsonResponse({}, { status: 500 }));
    await expect(findArticle("Intermittent fasting")).rejects.toThrow(WikiRequestError);
  });

  test("wraps a network failure in WikiRequestError", async () => {
    globalThis.fetch = async () => {
      throw new Error("boom");
    };
    await expect(findArticle("Intermittent fasting")).rejects.toThrow(
      /Network error/,
    );
  });
});

describe("getLanguageVersions", () => {
  test("maps the language-links response to {language, title, key, name}", async () => {
    mockFetch(() =>
      jsonResponse([
        { code: "cs", title: "Přerušovaný půst", key: "Přerušovaný_půst", name: "čeština" },
        { code: "de", title: "Intermittierendes Fasten", key: "Intermittierendes_Fasten", name: "Deutsch" },
      ]),
    );
    const result = await getLanguageVersions("Intermittent_fasting");
    expect(result).toEqual([
      { language: "cs", title: "Přerušovaný půst", key: "Přerušovaný_půst", name: "čeština" },
      { language: "de", title: "Intermittierendes Fasten", key: "Intermittierendes_Fasten", name: "Deutsch" },
    ]);
  });

  test("returns an empty array on a 404 instead of throwing", async () => {
    mockFetch(() => jsonResponse({}, { status: 404 }));
    expect(await getLanguageVersions("Some_Key")).toEqual([]);
  });

  test("propagates a non-404 error", async () => {
    mockFetch(() => jsonResponse({}, { status: 503 }));
    await expect(getLanguageVersions("Some_Key")).rejects.toThrow(WikiRequestError);
  });
});

describe("getPageviews", () => {
  function validArgs(overrides = {}) {
    return {
      language: "en",
      title: "Intermittent fasting",
      startDate: "20240101",
      endDate: "20240201",
      ...overrides,
    };
  }

  test("builds the expected Wikimedia pageviews URL", async () => {
    const calls = mockFetch(() => jsonResponse({ items: [] }));
    await getPageviews(validArgs());
    expect(calls[0].url).toBe(
      "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/" +
        "en.wikipedia/all-access/user/Intermittent_fasting/monthly/20240101/20240201",
    );
  });

  test("maps items to {timestamp, views}", async () => {
    mockFetch(() =>
      jsonResponse({
        items: [
          { timestamp: "2024010100", views: 123 },
          { timestamp: "2024020100", views: 456 },
        ],
      }),
    );
    const result = await getPageviews(validArgs());
    expect(result).toEqual({
      language: "en",
      title: "Intermittent fasting",
      pageviews: [
        { timestamp: "2024010100", views: 123 },
        { timestamp: "2024020100", views: 456 },
      ],
    });
  });

  test("rejects an invalid access value before making a request", async () => {
    const calls = mockFetch(() => jsonResponse({ items: [] }));
    await expect(
      getPageviews(validArgs({ access: "carrier-pigeon" })),
    ).rejects.toThrow(/Invalid access/);
    expect(calls).toHaveLength(0);
  });

  test("rejects an invalid agent value before making a request", async () => {
    const calls = mockFetch(() => jsonResponse({ items: [] }));
    await expect(getPageviews(validArgs({ agent: "robot" }))).rejects.toThrow(
      /Invalid agent/,
    );
    expect(calls).toHaveLength(0);
  });

  test("rejects an invalid granularity value before making a request", async () => {
    const calls = mockFetch(() => jsonResponse({ items: [] }));
    await expect(
      getPageviews(validArgs({ granularity: "weekly" })),
    ).rejects.toThrow(/Invalid granularity/);
    expect(calls).toHaveLength(0);
  });

  test("turns a 404 into a descriptive 'no pageview data' error", async () => {
    mockFetch(() => jsonResponse({}, { status: 404 }));
    await expect(getPageviews(validArgs())).rejects.toThrow(
      /No pageview data for 'Intermittent fasting' on en\.wikipedia between 20240101 and 20240201/,
    );
  });

  test("propagates a non-404 error unchanged", async () => {
    mockFetch(() => jsonResponse({}, { status: 500 }));
    await expect(getPageviews(validArgs())).rejects.toThrow(WikiRequestError);
  });
});
