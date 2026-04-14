'use strict';

/**
 * scrapers/ycJobs.js
 *
 * Scrapes workatastartup.com (the YC Jobs board) for AI/ML engineer listings
 * using Playwright.
 *
 * Exported function:
 *   scrapeYcJobs(browser, config)
 *     @param {import('playwright').Browser} browser - Launched Playwright browser
 *     @param {object} config  - User config from config/user.config.js
 *     @returns {Promise<Array>} Array of raw job objects
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

// ─── Salary / date helpers ────────────────────────────────────────────────────

/**
 * Normalises a raw salary string scraped from the DOM to one of:
 *   "$XXX,XXX - $XXX,XXX"  (annual range)
 *   "$XXX/hr"               (hourly)
 *   "Not listed"            (when nothing usable is found)
 */
function cleanSalary(raw) {
  if (!raw || typeof raw !== 'string' || !raw.trim()) return 'Not listed';
  const s = raw.trim();

  const hrMatch = /\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?\s*\/\s*hr/i.exec(s);
  if (hrMatch) return hrMatch[0].replace(/\s*[-–]\s*/, ' - ');

  const rangeMatch = /(\$[\d,]+(?:K)?)\s*[-–]\s*(\$[\d,]+(?:K)?)/i.exec(s);
  if (rangeMatch) return `${rangeMatch[1]} - ${rangeMatch[2]}`;

  const singleMatch = /\$[\d,]+(?:K)?/.exec(s);
  if (singleMatch) return singleMatch[0];

  return 'Not listed';
}

/**
 * Converts a raw date string from the DOM ("3 days ago", "2024-04-10", etc.)
 * to an ISO 8601 date string (YYYY-MM-DD). Falls back to today on failure.
 */
function parseDateText(raw, today) {
  if (!raw || typeof raw !== 'string') return today;
  const s = raw.trim();

  const agoMatch = /(\d+)\s*(d\b|h\b|m\b|min|day|hour|week)/i.exec(s);
  if (agoMatch) {
    const n    = Number.parseInt(agoMatch[1], 10);
    const unit = agoMatch[2].toLowerCase();
    const d    = new Date();
    if      (unit.startsWith('d')) d.setDate(d.getDate() - n);
    else if (unit.startsWith('w')) d.setDate(d.getDate() - n * 7);
    return d.toISOString().split('T')[0];
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];

  return today;
}

// Search URLs — role filter maps to "ML / AI" on workatastartup.com.
// The site uses query params: `role` accepts role slugs, `q` is a free-text query.
const SEARCH_URLS = [
  'https://www.workatastartup.com/jobs?role=ml-engineer&q=',
  'https://www.workatastartup.com/jobs?q=machine+learning+engineer',
  'https://www.workatastartup.com/jobs?q=AI+engineer',
];

// ─── DOM extraction (runs inside browser context) ─────────────────────────────

/**
 * Extracts job entries from the current workatastartup.com page.
 * Runs inside page.evaluate() — must be self-contained and serialisable.
 *
 * NOTE: findCompany is defined as an inner function intentionally.
 * page.evaluate() serialises the outer function by value (toString), so any
 * outer-scope references are unavailable in the browser context.  Keeping the
 * helper inner is the correct pattern for Playwright. // NOSONAR javascript:S7721
 *
 * @returns {Array<{title,company,location,salary,href}>}
 */
function extractYcJobs() {
  // workatastartup.com organises listings by company: each company section has
  // the company name at the top, with job rows below.  The company name is
  // therefore in an *ancestor* of the job row, not inside the row itself.

  // Checks the element itself, then walks up to 6 ancestor levels.
  // Inner scope is intentional: page.evaluate serialises by value so outer
  // references are unavailable in the browser. NOSONAR javascript:S7721
  function findCompany(el) { // NOSONAR
    const direct = el.querySelector(
      'a[href*="/companies/"], ' +
      '[class*="companyName"], [class*="company-name"], ' +
      '[class*="company"], [class*="startup"]'
    );
    if (direct) return direct.innerText.trim();

    let ancestor = el.parentElement;
    for (let i = 0; i < 6 && ancestor; i++) {
      if (ancestor.tagName === 'MAIN' || ancestor.tagName === 'BODY') break;
      const co = ancestor.querySelector('a[href*="/companies/"]');
      if (co) return co.innerText.trim();
      ancestor = ancestor.parentElement;
    }
    return '';
  }

  const items = Array.from(
    document.querySelectorAll(
      '[class*="JobRow"], [class*="job-row"], ' +
      'li[class*="job"], div[class*="job-listing"]'
    )
  );

  // Fallback: anchor tags pointing to /jobs/ detail pages.
  if (!items.length) {
    return Array.from(document.querySelectorAll('a[href*="/jobs/"]'))
      .filter(a => a.href.match(/\/jobs\/\d+/))
      .map(link => {
        const parent  = link.closest('div, li, article') || link.parentElement;
        const company = findCompany(parent || link);
        const text    = parent ? parent.innerText : link.innerText;
        const lines   = text.split('\n').map(l => l.trim()).filter(Boolean);
        return {
          title:    lines[0] || link.innerText.trim(),
          company:  company || lines[1] || 'Unknown',
          location: lines[2] || '',
          salary:   '',
          href:     link.href,
        };
      });
  }

  return items.map(item => {
    const titleEl    = item.querySelector('a[href*="/jobs/"], h2, h3, [class*="title"]');
    const locationEl = item.querySelector('[class*="location"], [class*="remote"]');
    const salaryEl   = item.querySelector('[class*="salary"], [class*="compensation"]');
    const linkEl     = item.querySelector('a[href*="/jobs/"]') || titleEl;

    // Date posted — prefer <time datetime="...">; fall back to relative text.
    const timeEl = item.querySelector('time[datetime]') ||
      item.querySelector('[class*="date"], [class*="posted"], [class*="time-ago"]');
    let dateRaw = '';
    if (timeEl) {
      dateRaw = timeEl.getAttribute('datetime') || timeEl.innerText.trim();
    } else {
      const scanEl = Array.from(item.querySelectorAll('span, p, div'))
        .find(el => el.children.length === 0 &&
          /\d+\s*(d\b|h\b|day|hour|week|ago)/i.test(el.innerText));
      if (scanEl) dateRaw = scanEl.innerText.trim();
    }

    return {
      title:    titleEl    ? titleEl.innerText.trim()    : '',
      company:  findCompany(item) || 'Unknown',
      location: locationEl ? locationEl.innerText.trim() : '',
      salary:   salaryEl   ? salaryEl.innerText.trim()   : '',
      dateRaw,
      href:     linkEl     ? linkEl.href                 : '',
    };
  });
}

// ─── Pagination / infinite scroll helper ─────────────────────────────────────

/**
 * Attempts to load more results — clicks a "Load more" button or scrolls to
 * trigger infinite scroll.  Returns true if more content was loaded.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function loadMore(page) {
  try {
    // Try explicit "Load more" / "Next" button first.
    const btn = await page.$(
      'button:has-text("Load more"), button:has-text("Show more"), ' +
      'a:has-text("Next"), [aria-label="Next page"]'
    );

    if (btn) {
      const disabled = await btn.evaluate(
        el => el.disabled || el.getAttribute('aria-disabled') === 'true'
      );
      if (!disabled) {
        await btn.click();
        await page.waitForTimeout(2500);
        return true;
      }
    }

    // Fall back to scrolling to the bottom for infinite-scroll pages.
    const prevHeight = await page.evaluate(() => document.body.scrollHeight);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2500);
    const newHeight = await page.evaluate(() => document.body.scrollHeight);

    return newHeight > prevHeight;
  } catch {
    return false;
  }
}

// ─── Inner loop helper ────────────────────────────────────────────────────────

/**
 * Drains job cards from the current page and subsequent pages/scrolls,
 * appending unique results to `jobs` until `max` is reached.
 *
/**
 * Converts one raw extracted item into a normalised job object.
 */
function buildJob(raw, today) {
  const datePosted = parseDateText(raw.dateRaw, today);
  if (!raw.dateRaw) console.log(`  [yc-jobs] no date found for "${raw.title}" — using today`);
  return {
    title:      raw.title,
    company:    raw.company  || '',
    location:   raw.location || 'Remote',
    salary:     cleanSalary(raw.salary),
    sourceUrl:  raw.href,
    datePosted,
  };
}

/**
 * @param {import('playwright').Page} page
 * @param {string} today
 * @param {number} max
 * @param {Set<string>} seen
 * @param {Array} jobs
 */
async function drainJobs(page, today, max, seen, jobs) {
  let hasMore = true;
  let firstBatchLogged = false;

  while (hasMore && jobs.length < max) {
    const extracted = await page.evaluate(extractYcJobs);

    if (!firstBatchLogged && extracted.length > 0) {
      console.log(`  [yc-jobs] DEBUG first 3 raw objects:`,
        JSON.stringify(extracted.slice(0, 3), null, 2));
      firstBatchLogged = true;
    }

    for (const raw of extracted) {
      if (jobs.length >= max) break;
      if (!raw.title || !raw.href || seen.has(raw.href)) continue;
      seen.add(raw.href);
      jobs.push(buildJob(raw, today));
    }

    console.log(`  [yc-jobs] ${jobs.length} jobs collected so far`);
    hasMore = await loadMore(page);
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Scrapes workatastartup.com for AI/ML roles and returns raw job objects.
 *
 * Navigates through search URLs, extracts job listings, handles pagination and
 * infinite scroll, and stops once config.scraper.maxJobsPerSource is reached.
 * No filtering or Notion writes are performed — returns raw data only.
 *
 * @param {import('playwright').Browser} browser
 * @param {object} config
 * @returns {Promise<Array<{title,company,location,salary,sourceUrl,datePosted}>>}
 */
async function scrapeYcJobs(browser, config) {
  const max   = config.scraper.maxJobsPerSource;
  const today = new Date().toISOString().split('T')[0];
  const seen  = new Set();
  const jobs  = [];

  const page = await browser.newPage();

  try {
    await page.setExtraHTTPHeaders({ 'User-Agent': USER_AGENT });
    await page.setViewportSize({ width: 1280, height: 900 });

    for (const startUrl of SEARCH_URLS) {
      if (jobs.length >= max) break;

      console.log(`  [yc-jobs] navigating to: ${startUrl}`);

      try {
        await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        await page
          .waitForSelector(
            '[class*="JobRow"], [class*="job-row"], a[href*="/jobs/"]',
            { timeout: 10000 }
          )
          .catch(() => {});

        await drainJobs(page, today, max, seen, jobs);
        await page.waitForTimeout(2000);
      } catch (err) {
        console.error(`  [yc-jobs] error on ${startUrl}:`, err.message);
      }
    }
  } finally {
    await page.close();
  }

  return jobs;
}

module.exports = { scrapeYcJobs };
