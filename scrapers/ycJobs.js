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
 * @returns {Array<{title,company,location,salary,href}>}
 */
function extractYcJobs() {
  // workatastartup.com renders jobs as list items; each links to a job detail
  // page at /jobs/{id}.  Try the most specific selector first.
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
        const parent = link.closest('div, li, article') || link.parentElement;
        const text   = parent ? parent.innerText : link.innerText;
        const lines  = text.split('\n').map(l => l.trim()).filter(Boolean);
        return {
          title:    lines[0] || link.innerText.trim(),
          company:  lines[1] || '',
          location: lines[2] || '',
          salary:   '',
          href:     link.href,
        };
      });
  }

  return items.map(item => {
    const titleEl    = item.querySelector('a[href*="/jobs/"], h2, h3, [class*="title"]');
    const companyEl  = item.querySelector('[class*="company"], [class*="startup"], h4');
    const locationEl = item.querySelector('[class*="location"], [class*="remote"]');
    const salaryEl   = item.querySelector('[class*="salary"], [class*="compensation"]');
    const linkEl     = item.querySelector('a[href*="/jobs/"]') || titleEl;

    return {
      title:    titleEl    ? titleEl.innerText.trim()    : '',
      company:  companyEl  ? companyEl.innerText.trim()  : '',
      location: locationEl ? locationEl.innerText.trim() : '',
      salary:   salaryEl   ? salaryEl.innerText.trim()   : '',
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
 * @param {import('playwright').Page} page
 * @param {string} today
 * @param {number} max
 * @param {Set<string>} seen
 * @param {Array} jobs
 */
async function drainJobs(page, today, max, seen, jobs) {
  let hasMore = true;

  while (hasMore && jobs.length < max) {
    const extracted = await page.evaluate(extractYcJobs);

    for (const raw of extracted) {
      if (jobs.length >= max) break;
      if (!raw.title || !raw.href || seen.has(raw.href)) continue;

      seen.add(raw.href);
      jobs.push({
        title:     raw.title,
        company:   raw.company  || '',
        location:  raw.location || 'Remote',
        salary:    raw.salary   || '',
        sourceUrl: raw.href,
        dateFound: today,
      });
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
 * @returns {Promise<Array<{title,company,location,salary,sourceUrl,dateFound}>>}
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
