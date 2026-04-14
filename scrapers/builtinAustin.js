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

const AI_TITLE_PATTERNS = [
  /\bai\b/i,
  /\bml\b/i,
  /machine learning/i,
  /artificial intelligence/i,
  /applied ai/i,
  /\bllm\b/i,
  /\bnlp\b/i,
  /generative ai/i,
  /research engineer/i,
  /research scientist/i,
  /applied scientist/i,
  /data scientist/i,
  /data science/i,
  /computer vision/i,
  /deep learning/i,
  /ai platform/i,
  /ai infrastructure/i,
  /\bagi\b/i,
  /robotics/i,
  /autonomy/i,
  /autonomous/i,
  /perception/i,
  /dexterous/i,
  /manipulation/i,
  /motion control/i,
  /\bintern(ship)?\b/i,
  /\bco-?op\b/i,
];

const IRRELEVANT_TITLE_PATTERNS = [
  /business development/i,
  /\bsales\b/i,
  /marketing/i,
  /\blegal\b/i,
  /counsel/i,
  /attorney/i,
  /\bsupport\b/i,
  /customer success/i,
  /partnership/i,
  /\brecruit/i,
  /\bproduct manager\b/i,
  /product marketing/i,
  /account executive/i,
  /solutions representative/i,
  /event coordinator/i,
  /\bfinance\b/i,
  /\bfacilities\b/i,
  /\bsubcontracts\b/i,
];

// ─── Salary / date helpers ────────────────────────────────────────────────────

/**
 * Normalises a raw salary string scraped from the DOM to one of:
 *   "$XXX,XXX - $XXX,XXX"  (annual range)
 *   "$XXX/hr"               (hourly)
 *   "Not listed"            (when nothing usable is found)
 *
 * Strips trailing noise like "Offers Equity", "USD", etc.
 */
function cleanSalary(raw) {
  if (!raw || typeof raw !== 'string' || !raw.trim()) return 'Not listed';
  const s = raw.trim();

  // Hourly: "$45/hr" or "$45 - $65/hr"
  const hrMatch = /\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?\s*\/\s*hr/i.exec(s);
  if (hrMatch) return hrMatch[0].replace(/\s*[-–]\s*/, ' - ');

  // Annual range: "$120,000 - $160,000" or "$120,000–$160,000"
  const rangeMatch = /(\$[\d,]+(?:K)?)\s*[-–]\s*(\$[\d,]+(?:K)?)/i.exec(s);
  if (rangeMatch) return `${rangeMatch[1]} - ${rangeMatch[2]}`;

  // Single dollar value
  const singleMatch = /\$[\d,]+(?:K)?/.exec(s);
  if (singleMatch) return singleMatch[0];

  return 'Not listed';
}

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
  // Use [data-id="job-card"] only — [class*="job-card"] accidentally matches
  // the outer wrapper div whose class includes "gap-job-cards", causing duplicates.
  const cards = Array.from(
    document.querySelectorAll('[data-id="job-card"], article.job-card')
  );

  // Fallback: collect all job-detail links and infer company from context.
  if (!cards.length) {
    return Array.from(document.querySelectorAll('a[href*="/job/"]')).map(link => {
      // BuiltIn company links use /company/ (singular).
      const parent    = link.closest('li, article, div[data-id]') || link.parentElement;
      const companyEl = parent?.querySelector('[data-id="company-title"], a[href*="/company/"]');
      return {
        title:    link.innerText.trim(),
        company:  companyEl ? companyEl.innerText.trim() : 'Unknown',
        location: 'Austin, TX',
        salary:   '',
        cardText: parent ? parent.innerText.trim() : link.innerText.trim(),
        href:     link.href,
      };
    });
  }

  return cards.map(card => {
    // data-id="job-card-title" = job link; data-id="company-title" = company link.
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

    // Location: BuiltIn encodes work arrangement + city in adjacent spans.
    // Match the first leaf span with recognisable location text.
    const locEl = Array.from(card.querySelectorAll('span'))
      .find(el => el.children.length === 0 && /remote|hybrid|in.office|TX|Austin/i.test(el.innerText.trim()));
    const location = locEl ? locEl.innerText.trim() : 'Austin, TX';

    return {
      title:    titleText,
      company,
      location,
      salary:   salaryEl ? salaryEl.innerText.trim() : '',
      cardText: card.innerText.trim(),
      href:     titleEl  ? titleEl.href              : '',
    };
  });
}

function looksRelevantBuiltinRole(raw) {
  const title = (raw.title || '').trim();
  if (!title) return false;

  if (IRRELEVANT_TITLE_PATTERNS.some(pattern => pattern.test(title))) {
    return false;
  }

  const haystack = `${title}\n${raw.cardText || ''}`;
  if (!AI_TITLE_PATTERNS.some(pattern => pattern.test(haystack))) {
    return false;
  }

  if (/\bintern(ship)?\b|\bco-?op\b/i.test(haystack)) {
    return /machine learning|artificial intelligence|applied ai|\bai\b|\bml\b|data science|robotics|research|computer vision|perception|autonomy|autonomous/i.test(haystack);
  }

  return true;
}

/**
 * Fetches the company name from a Built In job detail page when the card-level
 * extraction is blank.
 *
 * @param {import('playwright').Browser} browser
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchBuiltinCompanyFromDetail(browser, url) {
  const page = await browser.newPage();

  try {
    await page.setExtraHTTPHeaders({ 'User-Agent': USER_AGENT });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    return await page.evaluate(() => {
      const exactLink = document.querySelector('[data-id="company-title"], a[href*="/company/"]');
      const exactText = exactLink?.innerText?.trim();
      if (exactText) return exactText;

      const heading = document.querySelector('h1')?.innerText?.trim() || '';
      const bodyText = document.body.innerText;
      const headingIndex = bodyText.indexOf(heading);
      if (heading && headingIndex > 0) {
        const beforeHeading = bodyText.slice(0, headingIndex).trim().split('\n').map(s => s.trim()).filter(Boolean);
        const candidate = beforeHeading.at(-1);
        if (candidate && candidate !== heading) return candidate;
      }

      return '';
    });
  } catch {
    return '';
  } finally {
    await page.close();
  }
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
 * Converts one raw extracted card into a normalised job object.
 */
function buildJob(raw) {
  return {
    title:      raw.title,
    company:    raw.company  || '',
    location:   raw.location || 'Austin, TX',
    salary:     cleanSalary(raw.salary),
    sourceUrl:  raw.href,
  };
}

/**
 * Drains all job cards from the current page and any subsequent pages,
 * appending results to `jobs` until `max` is reached.
 *
 * @param {import('playwright').Page} page
 * @param {number} max
 * @param {Set<string>} seen
 * @param {Array} jobs
 */
async function drainPages(page, max, seen, jobs) {
  let hasMore = true;
  let firstBatchLogged = false;

  while (hasMore && jobs.length < max) {
    const extracted = await page.evaluate(extractBuiltinJobs);

    if (!firstBatchLogged && extracted.length > 0) {
      console.log(`  [builtin-austin] DEBUG first 3 raw objects:`,
        JSON.stringify(extracted.slice(0, 3), null, 2));
      firstBatchLogged = true;
    }

    for (const raw of extracted) {
      if (jobs.length >= max) break;
      if (!raw.title || !raw.href || seen.has(raw.href)) continue;
      if (!looksRelevantBuiltinRole(raw)) continue;
      seen.add(raw.href);
      jobs.push(buildJob(raw));
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
 * @returns {Promise<Array<{title,company,location,salary,sourceUrl}>>}
 */
async function scrapeBuiltinAustin(browser, config) {
  const max   = config.scraper.maxJobsPerSource;
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

        await drainPages(page, max, seen, jobs);
        await page.waitForTimeout(2000);
      } catch (err) {
        console.error(`  [builtin-austin] error on ${startUrl}:`, err.message);
      }
    }
  } finally {
    await page.close();
  }

  for (const job of jobs) {
    if (job.company && job.company.trim()) continue;

    console.log(`  [builtin-austin] DEBUG blank company raw job:`, JSON.stringify(job, null, 2));
    const detailCompany = await fetchBuiltinCompanyFromDetail(browser, job.sourceUrl);
    if (detailCompany) {
      job.company = detailCompany;
      console.log(`  [builtin-austin] recovered company from detail page: ${detailCompany}`);
    } else {
      console.log(`  [builtin-austin] company still blank after detail-page fallback: ${job.sourceUrl}`);
    }
  }

  return jobs;
}

module.exports = { scrapeBuiltinAustin };
