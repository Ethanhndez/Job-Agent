'use strict';

/**
 * scrapers/builtinHouston.js
 *
 * Scrapes builtin.com for AI/ML engineer job listings filtered to Houston, TX
 * and the broader Texas market (BuiltIn does not have a dedicated Houston city
 * page, so we target the Texas hub and the national search with a Houston filter).
 *
 * Exported function:
 *   scrapeBuiltinHouston(browser, config)
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

// BuiltIn does not have a standalone /houston city page.  We target the Texas
// hub (which covers Houston, Dallas, Austin) and the national ML category.
const SEARCH_URLS = [
  'https://builtin.com/jobs/texas/machine-learning',
  'https://builtin.com/jobs/texas/artificial-intelligence',
];

// ─── DOM extraction (runs inside browser context) ─────────────────────────────

/**
 * Extracts job card data from the current BuiltIn page.
 * Runs inside page.evaluate() — must be self-contained and serialisable.
 *
 * @returns {Array<{title,company,location,salary,href}>}
 */
function extractBuiltinJobs() {
  // Use [data-id="job-card"] only — [class*="job-card"] accidentally matches
  // the outer wrapper div whose class includes "gap-job-cards", causing duplicates.
  const cards = Array.from(
    document.querySelectorAll('[data-id="job-card"], article.job-card')
  );

  // Fallback: collect all job-detail links and infer company from context.
  if (!cards.length) {
    return Array.from(document.querySelectorAll('a[href*="/job/"]')).map(link => {
      const parent    = link.closest('li, article, div[data-id]') || link.parentElement;
      const companyEl = parent?.querySelector('[data-id="company-title"], a[href*="/company/"]');
      return {
        title:    link.innerText.trim(),
        company:  companyEl ? companyEl.innerText.trim() : 'Unknown',
        location: 'Houston, TX',
        salary:   '',
        href:     link.href,
      };
    });
  }

  return cards.map(card => {
    const titleEl   = card.querySelector('[data-id="job-card-title"], h2 a, h3 a, a[href*="/job/"]');
    // Exact data-id match avoids hitting data-id="company-img" on the logo <img>.
    const companyEl = card.querySelector('[data-id="company-title"]');
    const salaryEl  = card.querySelector('[class*="salary"], [class*="Salary"], [class*="compensation"]');

    const titleText = titleEl ? titleEl.innerText.trim() : '';

    // Positional fallback for company: first leaf-node text that is not the title.
    const company = companyEl ? companyEl.innerText.trim() : (() => {
      const leaf = Array.from(card.querySelectorAll('span, p, a'))
        .find(el => el.children.length === 0 && el.innerText.trim() && el.innerText.trim() !== titleText);
      return leaf ? leaf.innerText.trim() : 'Unknown';
    })();

    // Location: match the first leaf span with recognisable location text.
    const locEl = Array.from(card.querySelectorAll('span'))
      .find(el => el.children.length === 0 && /remote|hybrid|in.office|TX|Houston|Texas/i.test(el.innerText.trim()));
    const location = locEl ? locEl.innerText.trim() : 'Texas';

    // Date posted — prefer <time datetime="...">; fall back to relative text.
    const timeEl = card.querySelector('time[datetime]') ||
      card.querySelector('[class*="date"], [class*="posted"], [class*="time-ago"]');
    let dateRaw = '';
    if (timeEl) {
      dateRaw = timeEl.getAttribute('datetime') || timeEl.innerText.trim();
    } else {
      const scanEl = Array.from(card.querySelectorAll('span, p, div'))
        .find(el => el.children.length === 0 &&
          /\d+\s*(d\b|h\b|day|hour|week|ago)/i.test(el.innerText));
      if (scanEl) dateRaw = scanEl.innerText.trim();
    }

    return {
      title:    titleText,
      company,
      location,
      salary:   salaryEl ? salaryEl.innerText.trim() : '',
      dateRaw,
      href:     titleEl  ? titleEl.href              : '',
    };
  });
}

// ─── Pagination helper ────────────────────────────────────────────────────────

/**
 * Clicks the next-page control if present and waits for new content.
 * Returns true if another page was loaded, false if exhausted.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function goToNextPage(page) {
  try {
    const nextBtn = await page.$(
      '[aria-label="Next page"], [data-id="next-page"], ' +
      'a[rel="next"], button:has-text("Next"), a:has-text("Next")'
    );
    if (!nextBtn) return false;

    const isDisabled = await nextBtn.evaluate(
      el => el.disabled || el.getAttribute('aria-disabled') === 'true'
    );
    if (isDisabled) return false;

    await nextBtn.click();
    await page.waitForTimeout(2500);
    return true;
  } catch {
    return false;
  }
}

// ─── Inner loop helper ────────────────────────────────────────────────────────

/**
 * Drains all job cards from the current page and any subsequent pages,
 * appending unique results to `jobs` until `max` is reached.
 *
/**
 * Converts one raw extracted card into a normalised job object.
 */
function buildJob(raw, today) {
  const datePosted = parseDateText(raw.dateRaw, today);
  if (!raw.dateRaw) console.log(`  [builtin-houston] no date found for "${raw.title}" — using today`);
  return {
    title:      raw.title,
    company:    raw.company  || '',
    location:   raw.location || 'Texas',
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
async function drainPages(page, today, max, seen, jobs) {
  let hasMore = true;
  let firstBatchLogged = false;

  while (hasMore && jobs.length < max) {
    const extracted = await page.evaluate(extractBuiltinJobs);

    if (!firstBatchLogged && extracted.length > 0) {
      console.log(`  [builtin-houston] DEBUG first 3 raw objects:`,
        JSON.stringify(extracted.slice(0, 3), null, 2));
      firstBatchLogged = true;
    }

    for (const raw of extracted) {
      if (jobs.length >= max) break;
      if (!raw.title || !raw.href || seen.has(raw.href)) continue;
      seen.add(raw.href);
      jobs.push(buildJob(raw, today));
    }

    console.log(`  [builtin-houston] ${jobs.length} jobs collected so far`);
    hasMore = await goToNextPage(page);
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Scrapes builtin.com Texas hub for AI/ML roles and returns raw job objects.
 *
 * Navigates through category pages, extracts job cards, handles pagination,
 * and stops once config.scraper.maxJobsPerSource is reached.
 * No filtering or Notion writes are performed — returns raw data only.
 *
 * @param {import('playwright').Browser} browser
 * @param {object} config
 * @returns {Promise<Array<{title,company,location,salary,sourceUrl,datePosted}>>}
 */
async function scrapeBuiltinHouston(browser, config) {
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

      console.log(`  [builtin-houston] navigating to: ${startUrl}`);

      try {
        await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        await page
          .waitForSelector(
            '[data-id="job-card"], article.job-card, [class*="JobCard"], a[href*="/job/"]',
            { timeout: 10000 }
          )
          .catch(() => {});

        await drainPages(page, today, max, seen, jobs);
        await page.waitForTimeout(2000);
      } catch (err) {
        console.error(`  [builtin-houston] error on ${startUrl}:`, err.message);
      }
    }
  } finally {
    await page.close();
  }

  return jobs;
}

module.exports = { scrapeBuiltinHouston };
