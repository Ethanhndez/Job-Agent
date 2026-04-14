'use strict';

/**
 * test-scrape.js
 *
 * Runs BuiltIn Austin and YC Jobs scrapers in isolation and logs the first
 * 3 raw job objects from each source so you can verify company fields are
 * being captured correctly.  No Notion writes are performed.
 *
 * Usage:
 *   node test-scrape.js
 */

const { chromium } = require('playwright');
const { scrapeBuiltinAustin } = require('./scrapers/builtinAustin');
const { scrapeYcJobs }        = require('./scrapers/ycJobs');
const config                  = require('./config/user.config');

// Cap at 10 per source so the test finishes quickly.
const testConfig = {
  ...config,
  scraper: { ...config.scraper, maxJobsPerSource: 10, headless: true },
};

(async () => {
  const browser = await chromium.launch({ headless: testConfig.scraper.headless });

  try {
    console.log('\n══════════════════════════════════════════');
    console.log('  TEST SCRAPE — no Notion writes');
    console.log('══════════════════════════════════════════\n');

    // ── BuiltIn Austin ────────────────────────────────────────────────────────
    console.log('▶ BuiltIn Austin');
    const austinJobs = await scrapeBuiltinAustin(browser, testConfig);
    console.log(`\n  [builtin-austin] Total collected: ${austinJobs.length}`);
    console.log('  First 3 job objects:');
    console.log(JSON.stringify(austinJobs.slice(0, 3), null, 2));

    // ── YC Jobs ───────────────────────────────────────────────────────────────
    console.log('\n▶ YC Jobs (workatastartup.com)');
    const ycJobs = await scrapeYcJobs(browser, testConfig);
    console.log(`\n  [yc-jobs] Total collected: ${ycJobs.length}`);
    console.log('  First 3 job objects:');
    console.log(JSON.stringify(ycJobs.slice(0, 3), null, 2));

    console.log('\n══════════════════════════════════════════');
    console.log('  Done. Check company fields above.');
    console.log('══════════════════════════════════════════\n');
  } finally {
    await browser.close();
  }
})();
