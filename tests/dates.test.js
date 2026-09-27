import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MONTHS,
  DateRangeError,
  resolveDateRange,
  toApiDate,
} from "../scripts/lib/dates.js";

// Fixed clock so the tests never depend on the day they run.
const TODAY = new Date("2026-09-27T11:00:00Z");

function monthly(args = {}) {
  return resolveDateRange({ granularity: "monthly", today: TODAY, ...args });
}
function daily(args = {}) {
  return resolveDateRange({ granularity: "daily", today: TODAY, ...args });
}

/** Number of calendar months the inclusive range spans. */
function monthSpan({ start, end }) {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
}

describe("monthly granularity", () => {
  test("default window is whole months, not a mid-month slice", () => {
    const period = monthly();
    // Regression guard: the old default was `end - 2 years`, which landed on
    // 2024-08-31 and made the first bucket a single day (8 views instead of
    // 490), flipping totalChangePercent and inventing a -21σ anomaly.
    expect(period.start).toBe("2024-09-01");
    expect(period.end).toBe("2026-08-31");
    expect(period.start.endsWith("-01")).toBe(true);
    expect(monthSpan(period)).toBe(DEFAULT_MONTHS);
    expect(period.adjustments).toEqual([]);
  });

  test("default end is the last complete month, never the current one", () => {
    expect(monthly({ today: new Date("2026-09-01T00:00:00Z") }).end).toBe("2026-08-31");
    expect(monthly({ today: new Date("2026-09-30T23:59:00Z") }).end).toBe("2026-08-31");
    expect(monthly({ today: new Date("2026-10-01T00:00:00Z") }).end).toBe("2026-09-30");
  });

  test("default window is stable across a leap-year boundary", () => {
    const period = monthly({ today: new Date("2024-03-05T00:00:00Z") });
    expect(period).toMatchObject({ start: "2022-03-01", end: "2024-02-29" });
    expect(monthSpan(period)).toBe(DEFAULT_MONTHS);
  });

  test("explicit whole-month bounds are left alone", () => {
    const period = monthly({ start: "2024-01-01", end: "2024-12-31" });
    expect(period).toMatchObject({ start: "2024-01-01", end: "2024-12-31" });
    expect(monthSpan(period)).toBe(12);
    expect(period.adjustments).toEqual([]);
  });

  test("mid-month start is widened to the first of the month", () => {
    const period = monthly({ start: "2024-09-15", end: "2025-08-31" });
    expect(period.start).toBe("2024-09-01");
    expect(period.adjustments).toHaveLength(1);
    expect(period.adjustments[0]).toContain("2024-09-01");
  });

  test("mid-month end drops the partial bucket instead of inventing data", () => {
    const period = monthly({ start: "2025-01-01", end: "2026-04-15" });
    expect(period.end).toBe("2026-03-31");
    expect(period.adjustments[0]).toContain("2026-03-31");
  });

  test("an end inside the current month is pulled back to the last complete one", () => {
    const period = monthly({ start: "2025-01-01", end: "2026-09-15" });
    expect(period.end).toBe("2026-08-31");
    expect(period.adjustments[0]).toContain("has not finished yet");
  });

  test("a future end is pulled back to the last complete month", () => {
    expect(monthly({ start: "2025-01-01", end: "2030-01-31" }).end).toBe("2026-08-31");
  });

  test("both bounds can be corrected in one call", () => {
    const period = monthly({ start: "2024-03-10", end: "2025-07-20" });
    expect(period).toMatchObject({ start: "2024-03-01", end: "2025-06-30" });
    expect(period.adjustments).toHaveLength(2);
  });

  test("a single whole month is a valid range", () => {
    const period = monthly({ start: "2025-05-01", end: "2025-05-31" });
    expect(period).toMatchObject({ start: "2025-05-01", end: "2025-05-31" });
    expect(monthSpan(period)).toBe(1);
  });

  test("a start in the current month leaves no complete month to analyse", () => {
    expect(() => monthly({ start: "2026-09-01" })).toThrow(DateRangeError);
  });
});

describe("daily granularity", () => {
  test("default window ends yesterday and spans two years", () => {
    const period = daily();
    expect(period).toMatchObject({ start: "2024-09-26", end: "2026-09-26" });
    expect(period.adjustments).toEqual([]);
  });

  test("mid-month bounds are preserved — daily buckets are never partial", () => {
    const period = daily({ start: "2025-03-17", end: "2025-06-09" });
    expect(period).toMatchObject({ start: "2025-03-17", end: "2025-06-09" });
    expect(period.adjustments).toEqual([]);
  });

  test("an end past yesterday is clamped", () => {
    const period = daily({ start: "2026-01-01", end: "2026-12-31" });
    expect(period.end).toBe("2026-09-26");
    expect(period.adjustments[0]).toContain("2026-09-26");
  });

  test("today itself is clamped — its counts are still being collected", () => {
    expect(daily({ start: "2026-01-01", end: "2026-09-27" }).end).toBe("2026-09-26");
  });
});

describe("input validation", () => {
  test.each([
    ["2024-9-1", "non-padded"],
    ["01-09-2024", "wrong order"],
    ["2024/09/01", "wrong separator"],
    ["yesterday", "not a date"],
  ])("rejects malformed date %p (%s)", (value) => {
    expect(() => monthly({ start: value, end: "2026-08-31" })).toThrow(DateRangeError);
  });

  test("rejects a date that looks valid but does not exist", () => {
    // `new Date("2024-02-31")` silently rolls over to March 2nd.
    expect(() => monthly({ start: "2024-02-31" })).toThrow(/valid calendar date/);
    expect(() => monthly({ start: "2023-02-29" })).toThrow(/valid calendar date/);
  });

  test("accepts a real leap day", () => {
    expect(daily({ start: "2024-02-29", end: "2024-03-01" }).start).toBe("2024-02-29");
  });

  test("rejects an inverted range", () => {
    expect(() => daily({ start: "2026-01-01", end: "2025-01-01" })).toThrow(/empty range/);
  });

  test("an empty string means \"not provided\", not a malformed date", () => {
    expect(monthly({ start: "", end: "" })).toEqual(monthly());
  });

  test("names the offending flag in the message", () => {
    expect(() => monthly({ end: "nope" })).toThrow(/--end/);
    expect(() => monthly({ start: "nope" })).toThrow(/--start/);
  });
});

describe("toApiDate", () => {
  test("strips dashes for the pageviews API", () => {
    expect(toApiDate("2024-10-01")).toBe("20241001");
  });
});
