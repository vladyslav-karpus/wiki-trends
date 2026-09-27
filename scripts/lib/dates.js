/**
 * Date-range resolution for the Wikimedia pageviews API. Pure functions, no
 * network access and no I/O.
 *
 * The API buckets monthly data by calendar month but only counts the days
 * that fall inside the requested range — so a range starting or ending
 * mid-month produces a bucket holding a few days' worth of views while
 * still being labelled as a whole month. Those partial buckets look like
 * catastrophic drops and poison every downstream metric, so every range
 * resolved here is snapped to whole calendar months when granularity is
 * monthly.
 */

/** Monthly buckets in the default window. */
export const DEFAULT_MONTHS = 24;
/** Years in the default window at daily granularity. */
export const DEFAULT_DAILY_YEARS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class DateRangeError extends Error {
  constructor(message) {
    super(message);
    this.name = "DateRangeError";
  }
}

export function formatDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** `YYYY-MM-DD` -> `YYYYMMDD`, the format the pageviews API expects. */
export function toApiDate(isoDate) {
  return isoDate.replaceAll("-", "");
}

function parseIsoDate(value, flag) {
  if (!ISO_DATE.test(value)) {
    throw new DateRangeError(`${flag} must be a YYYY-MM-DD date (got '${value}')`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  // Rejects real-looking but non-existent dates such as 2024-02-31, which
  // `new Date` would silently roll over into the next month.
  if (Number.isNaN(date.getTime()) || formatDate(date) !== value) {
    throw new DateRangeError(`${flag} is not a valid calendar date (got '${value}')`);
  }
  return date;
}

function startOfDayUtc(date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Day 0 of the next month is the last day of this one. */
function endOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function addMonths(date, months) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()),
  );
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function addYears(date, years) {
  return new Date(
    Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth(), date.getUTCDate()),
  );
}

function resolveMonthly({ start, end, today, adjustments }) {
  // The current month is still accumulating views, so the newest bucket that
  // can be trusted is the last day of the previous month.
  const lastCompleteMonthEnd = addDays(startOfMonth(today), -1);

  let endDate;
  if (end) {
    const requested = parseIsoDate(end, "--end");
    const monthEnd = endOfMonth(requested);
    if (monthEnd.getTime() > lastCompleteMonthEnd.getTime()) {
      endDate = lastCompleteMonthEnd;
      adjustments.push(
        `--end ${end} falls in a month that has not finished yet; truncated to ${formatDate(endDate)}`,
      );
    } else if (requested.getTime() < monthEnd.getTime()) {
      endDate = addDays(startOfMonth(requested), -1);
      adjustments.push(
        `--end ${end} is mid-month; truncated to ${formatDate(endDate)} to drop the partial monthly bucket`,
      );
    } else {
      endDate = monthEnd;
    }
  } else {
    endDate = lastCompleteMonthEnd;
  }

  let startDate;
  if (start) {
    const requested = parseIsoDate(start, "--start");
    startDate = startOfMonth(requested);
    if (requested.getTime() !== startDate.getTime()) {
      adjustments.push(
        `--start ${start} is mid-month; widened to ${formatDate(startDate)} so the first monthly bucket is a whole month`,
      );
    }
  } else {
    startDate = addMonths(startOfMonth(endDate), -(DEFAULT_MONTHS - 1));
  }

  return { startDate, endDate };
}

function resolveDaily({ start, end, today, adjustments }) {
  // Today's counts are still being collected and are usually absent.
  const yesterday = addDays(today, -1);

  let endDate;
  if (end) {
    endDate = parseIsoDate(end, "--end");
    if (endDate.getTime() > yesterday.getTime()) {
      adjustments.push(
        `--end ${end} is later than the newest available day; truncated to ${formatDate(yesterday)}`,
      );
      endDate = yesterday;
    }
  } else {
    endDate = yesterday;
  }

  const startDate = start
    ? parseIsoDate(start, "--start")
    : addYears(endDate, -DEFAULT_DAILY_YEARS);

  return { startDate, endDate };
}

/**
 * Resolves the analysis window, snapping it to whole calendar months at
 * monthly granularity so no bucket is ever partial.
 *
 * @param {object} params
 * @param {string} [params.start] - requested start, `YYYY-MM-DD`.
 * @param {string} [params.end] - requested end, `YYYY-MM-DD`.
 * @param {"daily"|"monthly"} params.granularity
 * @param {Date} [params.today] - injectable clock, for tests.
 * @returns {{start: string, end: string, adjustments: string[]}} `adjustments`
 *   lists every correction applied, so the caller can tell the user what the
 *   analysed window actually is.
 * @throws {DateRangeError} on a malformed date or an empty range.
 */
export function resolveDateRange({ start, end, granularity, today = new Date() }) {
  const clock = startOfDayUtc(today);
  const adjustments = [];

  const { startDate, endDate } =
    granularity === "monthly"
      ? resolveMonthly({ start, end, today: clock, adjustments })
      : resolveDaily({ start, end, today: clock, adjustments });

  if (startDate.getTime() > endDate.getTime()) {
    throw new DateRangeError(
      `empty range: start ${formatDate(startDate)} is after end ${formatDate(endDate)}`,
    );
  }

  return { start: formatDate(startDate), end: formatDate(endDate), adjustments };
}
