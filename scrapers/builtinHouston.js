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
  const cards = Array.from(
    document.querySelectorAll(
      '[data-id="job-card"], article.job-card, ' +
      '[class*="JobCard"], [class*="job-card"]'
    )
  );

  if (!cards.length) {
    return Array.from(document.querySelectorAll('a[href*="/job/"]')).map(link => ({
      title:    link.innerText.trim(),
      company:  '',
      location: 'Houston, TX',
      salary:   '',
      href:     link.href,
    }));
  }

  return cards.map(card => {
    const titleEl    = card.querySelector('h2 a, h3 a, [class*="title"] a, a[href*="/job/"]');
    const companyEl  = card.querySelector('[class*="company"], [class*="Company"]');
    const locationEl = card.querySelector('[class*="location"], [class*="Location"]');
    const salaryEl   = card.querySelector('[class*="salary"], [class*="Salary"], [class*="compensation"]');

    return {
      title:    titleEl    ? titleEl.innerText.trim()    : '',
      company:  companyEl  ? companyEl.innerText.trim()  : '',
      location: locationEl ? locationEl.innerText.trim() : 'Texas',
      salary:   salaryEl   ? salaryEl.innerText.trim()   : '',
      href:     titleEl    ? titleEl.href                : '',
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
 * @param {import('playwright').Page} page
 * @param {string} today
 * @param {number} max
 * @param {Set<string>} seen
 * @param {Array} jobs
 */
async function drainPages(page, today, max, seen, jobs) {
  let hasMore = true;

  while (hasMore && jobs.length < max) {
    const extracted = await page.evaluate(extractBuiltinJobs);

    for (const raw of extracted) {
      if (jobs.length >= max) break;
      if (!raw.title || !raw.href || seen.has(raw.href)) continue;

      seen.add(raw.href);
      jobs.push({
        title:     raw.title,
        company:   raw.company  || '',
        location:  raw.location || 'Texas',
        salary:    raw.salary   || '',
        sourceUrl: raw.href,
        dateFound: today,
      });
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
 * @returns {Promise<Array<{title,company,location,salary,sourceUrl,dateFound}>>}
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
