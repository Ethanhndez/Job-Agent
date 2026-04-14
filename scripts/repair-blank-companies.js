'use strict';

/**
 * scripts/repair-blank-companies.js
 *
 * One-time repair script for Job Listings rows whose Company field is blank.
 *
 * Strategy:
 *   1. Query the Job Listings DB for rows with an empty Company property
 *   2. Visit each Source URL with Playwright
 *   3. Recover the company name from the detail page when the source exposes it
 *   4. Update the Notion row only when a concrete company name is found
 *
 * Supported sources:
 *   - Built In job detail pages
 *   - YC / Work at a Startup job detail pages
 *
 * Run: node scripts/repair-blank-companies.js
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { Client } = require('@notionhq/client');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'notion.config.json');
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

async function fetchBuiltinCompany(browser, url) {
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

async function fetchYcCompany(browser, url) {
  const page = await browser.newPage();

  try {
    await page.setExtraHTTPHeaders({ 'User-Agent': USER_AGENT });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    return await page.evaluate(() => {
      const companyLink = document.querySelector('a[href*="/companies/"]');
      const companyText = companyLink?.innerText?.trim();
      if (companyText) return companyText;

      const h1 = document.querySelector('h1')?.innerText?.trim() || '';
      const match = /\sat\s(.+?)(?:\s\([A-Z]\d+\))?$/.exec(h1);
      return match ? match[1].trim() : '';
    });
  } catch {
    return '';
  } finally {
    await page.close();
  }
}

async function recoverCompany(browser, url) {
  if (url.includes('builtin.com')) return fetchBuiltinCompany(browser, url);
  if (url.includes('workatastartup.com')) return fetchYcCompany(browser, url);
  return '';
}

async function main() {
  if (!process.env.NOTION_TOKEN) {
    throw new Error('NOTION_TOKEN is not set. Add it to .env before running this script.');
  }

  const { jobListingsDbId } = loadConfig();
  const notion = new Client({ auth: process.env.NOTION_TOKEN });
  const browser = await chromium.launch({ headless: true });

  try {
    const response = await notion.databases.query({
      database_id: jobListingsDbId,
      filter: {
        property: 'Company',
        rich_text: { is_empty: true },
      },
      page_size: 100,
    });

    console.log(`Found ${response.results.length} rows with blank Company.`);

    let updated = 0;
    let unresolved = 0;

    for (const page of response.results) {
      const title = (page.properties['Job Title']?.title || []).map(t => t.plain_text).join('');
      const sourceUrl = page.properties['Source URL']?.url || '';

      console.log(`\n[repair-company] ${title}`);
      console.log(`  URL: ${sourceUrl}`);

      const company = sourceUrl ? await recoverCompany(browser, sourceUrl) : '';
      if (!company) {
        unresolved++;
        console.log('  Could not recover company from the source page.');
        continue;
      }

      await notion.pages.update({
        page_id: page.id,
        properties: {
          'Company': {
            rich_text: [{ text: { content: company } }],
          },
        },
      });

      updated++;
      console.log(`  Updated Company → ${company}`);
      await new Promise(resolve => setTimeout(resolve, 350));
    }

    console.log(`\nRepair complete. Updated ${updated} rows; ${unresolved} unresolved.`);
  } finally {
    await browser.close();
  }
}

(async () => {
  try {
    await main();
  } catch (err) {
    console.error('\nRepair failed:', err.message);
    process.exit(1);
  }
})();
