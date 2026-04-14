'use strict';

/**
 * scrapers/wellfound.js
 *
 * Scrapes Wellfound (formerly AngelList Talent) for AI/ML engineer job listings.
 *
 * Exported function:
 *   scrapeWellfound(browser, config)
 *     @param {import('playwright').Browser} browser - Launched Playwright browser
 *     @param {object} config  - User config from config/user.config.js
 *     @returns {Promise<Array>} Array of raw job objects
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

const SEARCH_QUERIES = [
  'machine learning engineer',
  'AI engineer',
  'LLM engineer',
];

// ─── Page-level extraction (runs inside browser context) ─────────────────────

/**
 * Extracts raw job entries from whatever job cards are currently visible.
 * Tries three selector strategies in order; returns an array of plain objects.
 * Runs inside page.evaluate() — must be a serialisable, self-contained function.
 */
function extractJobsFromDOM() {
  // Strategy 1: stable data-test attributes.
  let cards = document.querySelectorAll('[data-test="JobSearchResult"]');

  // Strategy 2: ARIA list items inside a jobs container.
  if (!cards.length) {
    cards = document.querySelectorAll('[role="listitem"]');
  }

  // Strategy 3: fall back to bare job-link anchors.
  if (!cards.length) {
    return Array.from(document.querySelectorAll('a[href*="/jobs/"]')).map(link => {
      const parent = link.closest('div, article, li') || link.parentElement;
      return {
        title:    link.innerText.trim(),
        company:  '',
        location: '',
        salary:   '',
        href:     link.href,
        allText:  parent ? parent.innerText : '',
      };
    });
  }

  // Parse each card by querying child elements inline.
  return Array.from(cards).map(card => {
    const titleEl    = card.querySelector('a[href*="/jobs/"], h3, h2');
    const companyEl  = card.querySelector('[data-test="StartupLink"], [class*="company"], h4');
    const locationEl = card.querySelector('[class*="location"], [class*="Location"]');
    const salaryEl   = card.querySelector('[class*="salary"], [class*="compensation"]');
    const linkEl     = card.querySelector('a[href*="/jobs/"]') || titleEl;

    return {
      title:    titleEl    ? titleEl.innerText.trim()    : '',
      company:  companyEl  ? companyEl.innerText.trim()  : '',
      location: locationEl ? locationEl.innerText.trim() : '',
      salary:   salaryEl   ? salaryEl.innerText.trim()   : '',
      href:     linkEl     ? linkEl.href                 : '',
      allText:  card.innerText,
    };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolves company name from a raw extracted object.
 * When the selector missed the company, attempts to pull the first non-title
 * line of the card's full text.
 *
 * @param {{ company: string, title: string, allText: string }} raw
 * @returns {string}
 */
function resolveCompany(raw) {
  if (raw.company) return raw.company;

  const firstOther = raw.allText
    .split('\n')
    .map(l => l.trim())
    .find(l => l && l !== raw.title);

  return firstOther || '';
}

/**
 * Converts a raw extracted object into the canonical job shape.
 *
 * @param {{ title:string, company:string, location:string, salary:string, href:string, allText:string }} raw
 * @param {string} today - ISO date string
 * @returns {{ title, company, location, salary, sourceUrl, dateFound }}
 */
function toJob(raw, today) {
  return {
    title:     raw.title,
    company:   resolveCompany(raw),
    location:  raw.location || 'Remote',
    salary:    raw.salary   || '',
    sourceUrl: raw.href,
    dateFound: today,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Scrapes Wellfound for AI/ML roles and returns raw job objects.
 *
 * Iterates through SEARCH_QUERIES, de-duplicates by URL, and stops once
 * config.scraper.maxJobsPerSource is reached.  No filtering or Notion writes
 * are performed — returns raw data only.
 *
 * @param {import('playwright').Browser} browser
 * @param {object} config
 * @returns {Promise<Array<{title:string,company:string,location:string,salary:string,sourceUrl:string,dateFound:string}>>}
 */
async function scrapeWellfound(browser, config) {
  const max   = config.scraper.maxJobsPerSource;
  const today = new Date().toISOString().split('T')[0];
  const seen  = new Set();
  const jobs  = [];

  const page = await browser.newPage();

  try {
    await page.setExtraHTTPHeaders({ 'User-Agent': USER_AGENT });
    await page.setViewportSize({ width: 1280, height: 900 });

    for (const query of SEARCH_QUERIES) {
      if (jobs.length >= max) break;
      await scrapeQuery(page, query, today, max, seen, jobs);
    }
  } finally {
    await page.close();
  }

  return jobs;
}

/**
 * Runs one search query on Wellfound and appends valid results to `jobs`.
 *
 * @param {import('playwright').Page} page
 * @param {string} query
 * @param {string} today
 * @param {number} max
 * @param {Set<string>} seen
 * @param {Array} jobs
 */
async function scrapeQuery(page, query, today, max, seen, jobs) {
  const url = `https://wellfound.com/jobs?q=${encodeURIComponent(query)}&l=Remote`;
  console.log(`  [wellfound] searching: "${query}"`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    await page
      .waitForSelector(
        '[data-test="JobSearchResult"], [role="listitem"], a[href*="/jobs/"]',
        { timeout: 10000 }
      )
      .catch(() => {});

    const extracted = await page.evaluate(extractJobsFromDOM);

    for (const raw of extracted) {
      if (jobs.length >= max) break;
      if (!raw.title || !raw.href || seen.has(raw.href)) continue;

      seen.add(raw.href);
      jobs.push(toJob(raw, today));
    }

    console.log(`  [wellfound] ${jobs.length} jobs collected so far`);
    await page.waitForTimeout(2000);
  } catch (err) {
    console.error(`  [wellfound] error on query "${query}":`, err.message);
  }
}

module.exports = { scrapeWellfound };
