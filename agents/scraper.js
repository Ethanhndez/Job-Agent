'use strict';

/**
 * agents/scraper.js
 *
 * Orchestrates the full scraping pipeline:
 *   1. Launches a Playwright browser
 *   2. Runs each scraper in sequence (avoiding parallel rate-limit / detection issues)
 *   3. For each raw job: fingerprint → filter → URL dedupe → fingerprint dedupe → Notion write
 *   4. Closes the browser and prints a summary
 *
 * Exported function:
 *   runScraper()
 *     @returns {Promise<void>}
 */

require('dotenv').config();

const { chromium }    = require('playwright');
const { Client }      = require('@notionhq/client');

const {
  loadNotionConfig,
  jobExistsByUrl,
  jobExistsByFingerprint,
  createJobPage,
} = require('./notionWriter');

const { generateFingerprint, applyFilters } = require('../utils/dedupe');

const { scrapeWellfound }     = require('../scrapers/wellfound');
const { scrapeGreenhouse }    = require('../scrapers/greenhouse');
const { scrapeLever }         = require('../scrapers/lever');
const { scrapeAshby }         = require('../scrapers/ashby');
const { scrapeBuiltinAustin } = require('../scrapers/builtinAustin');
const { scrapeBuiltinHouston }= require('../scrapers/builtinHouston');
const { scrapeYcJobs }        = require('../scrapers/ycJobs');

// ─── Scraper registry ─────────────────────────────────────────────────────────

/**
 * Each entry pairs a human-readable label with its scraper function.
 * Scrapers run in the order listed — sequential, not parallel.
 */
const SCRAPERS = [
  { label: 'Wellfound',      fn: scrapeWellfound     },
  { label: 'Greenhouse',     fn: scrapeGreenhouse     },
  { label: 'Lever',          fn: scrapeLever          },
  { label: 'Ashby',          fn: scrapeAshby          },
  { label: 'BuiltIn Austin', fn: scrapeBuiltinAustin  },
  { label: 'BuiltIn Houston',fn: scrapeBuiltinHouston },
  { label: 'YC Jobs',        fn: scrapeYcJobs         },
];

// ─── Per-job processing ───────────────────────────────────────────────────────

/**
 * Processes a single raw job through the full pipeline:
 *   fingerprint → filter → URL dedupe → fingerprint dedupe → Notion write.
 *
 * Returns a status string: 'written' | 'filtered' | 'duplicate'.
 *
 * @param {object} rawJob          - Raw job from a scraper
 * @param {object} config          - User config
 * @param {Client} notionClient    - Authenticated Notion client
 * @param {string} dbId            - Job Listings DB ID
 * @param {object} stats           - Mutable stats counters
 * @returns {Promise<'written'|'filtered'|'duplicate'>}
 */
async function processJob(rawJob, config, notionClient, dbId, stats) {
  // ── Fingerprint ────────────────────────────────────────────────────────────
  const fingerprint = generateFingerprint(
    rawJob.company,
    rawJob.title,
    rawJob.location
  );

  const job = { ...rawJob, fingerprint };

  // ── Tier filters ───────────────────────────────────────────────────────────
  const { pass, failedTier } = applyFilters(job, config);
  if (!pass) {
    stats.filtered++;
    return { status: 'filtered', failedTier };
  }

  stats.passedFilters++;

  // ── Deduplication: URL ─────────────────────────────────────────────────────
  try {
    if (await jobExistsByUrl(notionClient, dbId, job.sourceUrl)) {
      stats.duplicates++;
      return { status: 'duplicate', failedTier: null };
    }
  } catch (err) {
    console.warn(`    [dedupe-url] Notion check failed (${err.message}) — skipping write`);
    stats.duplicates++;
    return { status: 'duplicate', failedTier: null };
  }

  // ── Deduplication: fingerprint ─────────────────────────────────────────────
  try {
    if (await jobExistsByFingerprint(notionClient, dbId, fingerprint)) {
      stats.duplicates++;
      return { status: 'duplicate', failedTier: null };
    }
  } catch (err) {
    console.warn(`    [dedupe-fp] Notion check failed (${err.message}) — skipping write`);
    stats.duplicates++;
    return { status: 'duplicate', failedTier: null };
  }

  // ── Write to Notion ────────────────────────────────────────────────────────
  try {
    await createJobPage(notionClient, dbId, job);
    stats.written++;
    return { status: 'written', failedTier: null };
  } catch (err) {
    console.error(`    [notion] write failed for "${job.title}" @ ${job.company}: ${err.message}`);
    stats.errors++;
    return { status: 'filtered', failedTier: null };
  }
}

// ─── Per-source runner ────────────────────────────────────────────────────────

/**
 * Runs one scraper, then processes each returned job through the pipeline.
 *
 * @param {{ label: string, fn: Function }} scraper
 * @param {import('playwright').Browser} browser
 * @param {object} config
 * @param {Client} notionClient
 * @param {string} dbId
 * @param {object} stats
 */
async function runOneScraper(scraper, browser, config, notionClient, dbId, stats) {
  console.log(`\n── ${scraper.label} ──────────────────────────────────────`);

  let rawJobs;
  try {
    rawJobs = await scraper.fn(browser, config);
  } catch (err) {
    console.error(`  [${scraper.label}] scraper threw: ${err.message}`);
    return;
  }

  console.log(`  found ${rawJobs.length} raw listings`);
  stats.found += rawJobs.length;

  for (const rawJob of rawJobs) {
    const { status, failedTier } = await processJob(rawJob, config, notionClient, dbId, stats);

    const label = `${rawJob.title} @ ${rawJob.company}`;
    if (status === 'written') {
      console.log(`  ✓ written   — ${label}`);
    } else if (status === 'duplicate') {
      console.log(`  ↩ duplicate — ${label}`);
    } else {
      const tierLabel = failedTier ? ` [tier ${failedTier}]` : '';
      console.log(`  ✗ filtered${tierLabel}  — ${label}`);
    }
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Entry point for the scraping pipeline.
 *
 * Loads config and credentials, launches Playwright, runs every scraper in
 * sequence, and closes the browser before printing a final summary.
 *
 * @returns {Promise<void>}
 */
async function runScraper() {
  // ── Load configs ───────────────────────────────────────────────────────────
  let userConfig;
  try {
    userConfig = require('../config/user.config');
  } catch {
    console.error(
      'config/user.config.js not found.\n' +
      'Copy config/user.config.example.js → config/user.config.js and fill it in.'
    );
    process.exit(1);
  }

  let notionConfig;
  try {
    notionConfig = loadNotionConfig();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  if (!process.env.NOTION_TOKEN) {
    console.error('NOTION_TOKEN is not set. Add it to your .env file.');
    process.exit(1);
  }

  // ── Init Notion client ─────────────────────────────────────────────────────
  const notionClient = new Client({ auth: process.env.NOTION_TOKEN });
  const dbId         = notionConfig.jobListingsDbId;

  // ── Launch browser ─────────────────────────────────────────────────────────
  const browser = await chromium.launch({
    headless: userConfig.scraper.headless,
    slowMo:   userConfig.scraper.slowMo,
  });

  const stats = {
    found:        0,
    passedFilters:0,
    filtered:     0,
    duplicates:   0,
    written:      0,
    errors:       0,
  };

  console.log('job-agent scraper starting…');
  console.log(`  DB: ${dbId}`);
  console.log(`  Max per source: ${userConfig.scraper.maxJobsPerSource}`);

  try {
    for (const scraper of SCRAPERS) {
      await runOneScraper(scraper, browser, userConfig, notionClient, dbId, stats);
    }
  } finally {
    await browser.close();
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  SCRAPE COMPLETE');
  console.log('══════════════════════════════════════════════════════');
  console.log(`  Total found      : ${stats.found}`);
  console.log(`  Passed filters   : ${stats.passedFilters}`);
  console.log(`  Written to Notion: ${stats.written}`);
  console.log(`  Duplicates skipped: ${stats.duplicates}`);
  console.log(`  Filtered out     : ${stats.filtered}`);
  if (stats.errors) {
    console.log(`  Notion errors    : ${stats.errors}`);
  }
  console.log('══════════════════════════════════════════════════════\n');
}

module.exports = { runScraper };
