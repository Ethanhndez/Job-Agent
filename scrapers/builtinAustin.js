'use strict';

/**
 * scrapers/builtinAustin.js
 *
 * Scrapes builtin.com/austin for AI/ML engineer job listings using Playwright.
 *
 * Exported function:
 *   scrapeBuiltinAustin(browser, config)
 *     @param {import('playwright').Browser} browser - Launched Playwright browser
 *     @param {object} config  - User config from config/user.config.js
 *     @returns {Promise<Array>} Array of raw job objects
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

// BuiltIn category slugs to scrape for Austin.
const SEARCH_URLS = [
  'https://builtin.com/jobs/austin/machine-learning',
  'https://builtin.com/jobs/austin/artificial-intelligence',
];

// ─── DOM extraction (runs inside browser context) ─────────────────────────────

/**
 * Extracts job card data from the current BuiltIn page.
 * Runs inside page.evaluate() — must be self-contained and serialisable.
 *
 * @returns {Array<{title,company,location,salary,href}>}
 */
function extractBuiltinJobs() {
  // BuiltIn renders job cards as <div> elements with a data-id attribute,
  // or as <article> elements.  Try both selector patterns.
  const cards = Array.from(
    document.querySelectorAll(
      '[data-id="job-card"], article.job-card, ' +
      '[class*="JobCard"], [class*="job-card"]'
    )
  );

  // Fallback: collect all job-detail links.
  if (!cards.length) {
    return Array.from(document.querySelectorAll('a[href*="/job/"]')).map(link => ({
      title:    link.innerText.trim(),
      company:  '',
      location: 'Austin, TX',
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
      location: locationEl ? locationEl.innerText.trim() : 'Austin, TX',
      salary:   salaryEl   ? salaryEl.innerText.trim()   : '',
      href:     titleEl    ? titleEl.href                : '',
    };
  });
}

// ─── Pagination helper ────────────────────────────────────────────────────────

/**
 * Clicks the "next page" or "load more" control if present.
 * Returns true if another page was loaded, false if pagination is exhausted.
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

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Drains all job cards from the current page and any subsequent pages,
 * appending results to `jobs` until `max` is reached.
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
        location:  raw.location || 'Austin, TX',
        salary:    raw.salary   || '',
        sourceUrl: raw.href,
        dateFound: today,
      });
    }

    console.log(`  [builtin-austin] ${jobs.length} jobs collected so far`);
    hasMore = await goToNextPage(page);
  }
}

/**
 * Scrapes builtin.com/austin for AI/ML roles and returns raw job objects.
 *
 * Navigates through category pages, extracts job cards, handles pagination,
 * and stops once config.scraper.maxJobsPerSource is reached.
 * No filtering or Notion writes are performed — returns raw data only.
 *
 * @param {import('playwright').Browser} browser
 * @param {object} config
 * @returns {Promise<Array<{title,company,location,salary,sourceUrl,dateFound}>>}
 */
async function scrapeBuiltinAustin(browser, config) {
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

      console.log(`  [builtin-austin] navigating to: ${startUrl}`);

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
        console.error(`  [builtin-austin] error on ${startUrl}:`, err.message);
      }
    }
  } finally {
    await page.close();
  }

  return jobs;
}

module.exports = { scrapeBuiltinAustin };
