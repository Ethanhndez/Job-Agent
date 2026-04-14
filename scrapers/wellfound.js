'use strict';

/**
 * scrapers/wellfound.js
 *
 * Wellfound (formerly AngelList Talent) requires authentication to access job
 * search results — the login wall appears before any listings load. There is no
 * public API or RSS feed available without an account.
 *
 * This scraper is gracefully disabled: it logs a warning and returns an empty
 * array so the rest of the pipeline is unaffected.
 *
 * Exported function:
 *   scrapeWellfound(browser, config)
 *     @param {import('playwright').Browser} browser - (unused)
 *     @param {object} config  - (unused)
 *     @returns {Promise<Array>} Always returns []
 */

async function scrapeWellfound(_browser, _config) {
  console.log('  [wellfound] Wellfound requires authentication — skipping');
  return [];
}

module.exports = { scrapeWellfound };
