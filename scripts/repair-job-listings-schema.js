'use strict';

/**
 * scripts/repair-job-listings-schema.js
 *
 * One-time repair script for an existing Job Listings DB that was created
 * before the current schema rules were in place.
 *
 * What it does:
 *   1. Verifies the title property is named "Job Title"
 *   2. Converts "Date Posted" to rich text if needed
 *   3. Rewrites every row's "Date Posted" value as text
 *   4. Backfills missing "Date Posted" values to "Not Posted"
 *   5. Replaces the known historical fake fallback date with "Not Posted"
 *
 * Safe behavior:
 *   - Existing real date values are preserved as YYYY-MM-DD text
 *   - Blank / missing values become exactly "Not Posted"
 *   - The known historical fake fallback date is rewritten to "Not Posted"
 *   - It does NOT guess any other dates
 *
 * Run once: node scripts/repair-job-listings-schema.js
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('@notionhq/client');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'notion.config.json');
const KNOWN_BAD_FALLBACK_DATE = '2026-04-14';

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

function getTitlePropertyName(properties) {
  const entry = Object.entries(properties).find(([, value]) => value.type === 'title');
  return entry ? entry[0] : null;
}

function getTitle(page, titlePropertyName) {
  return (page.properties[titlePropertyName]?.title || [])
    .map(part => part.plain_text)
    .join('');
}

function getPostedText(page, postedPropertyName) {
  const prop = postedPropertyName ? page.properties[postedPropertyName] : null;
  if (!prop) return 'Not Posted';

  if (prop.type === 'date') {
    return prop.date?.start || 'Not Posted';
  }

  if (prop.type === 'rich_text') {
    const text = (prop.rich_text || []).map(part => part.plain_text).join('').trim();
    return text || 'Not Posted';
  }

  return 'Not Posted';
}

function normalizePostedText(datePosted, createdDay) {
  if (!datePosted || datePosted === 'Not listed' || datePosted === 'Not Posted') {
    return 'Not Posted';
  }

  if (datePosted === KNOWN_BAD_FALLBACK_DATE && createdDay === KNOWN_BAD_FALLBACK_DATE) {
    return 'Not Posted';
  }

  return datePosted;
}

async function fetchAllPages(notion, databaseId) {
  const pages = [];
  let cursor;

  do {
    const response = await notion.databases.query({
      database_id: databaseId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });

    pages.push(...response.results);
    cursor = response.has_more ? response.next_cursor : null;
  } while (cursor);

  return pages;
}

async function main() {
  if (!process.env.NOTION_TOKEN) {
    throw new Error('NOTION_TOKEN is not set. Add it to .env before running this script.');
  }

  const { jobListingsDbId } = loadConfig();
  const notion = new Client({ auth: process.env.NOTION_TOKEN });

  console.log('Fetching current Job Listings DB schema...');
  const database = await notion.databases.retrieve({ database_id: jobListingsDbId });
  const titlePropertyName = getTitlePropertyName(database.properties);
  const datePostedProperty =
    database.properties['Date Posted'] ||
    database.properties['Date Found'] ||
    null;
  const datePostedPropertyName = database.properties['Date Posted']
    ? 'Date Posted'
    : (database.properties['Date Found'] ? 'Date Found' : null);

  if (!titlePropertyName) {
    throw new Error('No title property found in Job Listings DB.');
  }

  console.log(`  Current title property: ${titlePropertyName}`);
  console.log(
    `  Current Date Posted property: ${datePostedPropertyName || 'missing'} ` +
    `(${datePostedProperty ? datePostedProperty.type : 'missing'})`
  );

  console.log('\nReading existing rows before schema repair...');
  const pages = await fetchAllPages(notion, jobListingsDbId);
  const pageUpdates = pages.map(page => ({
    id: page.id,
    title: getTitle(page, titlePropertyName),
    datePosted: normalizePostedText(
      getPostedText(page, datePostedPropertyName),
      page.created_time.split('T')[0]
    ),
    createdDay: page.created_time.split('T')[0],
  }));

  console.log(`  Found ${pageUpdates.length} rows.`);

  const schemaPatch = {};

  if (titlePropertyName !== 'Job Title') {
    schemaPatch[titlePropertyName] = { name: 'Job Title' };
  }

  if (!datePostedProperty) {
    schemaPatch['Date Posted'] = { rich_text: {} };
  } else if (datePostedPropertyName === 'Date Found') {
    schemaPatch['Date Found'] = { name: 'Date Posted', rich_text: {} };
  } else if (datePostedProperty.type !== 'rich_text') {
    schemaPatch['Date Posted'] = { rich_text: {} };
  }

  if (Object.keys(schemaPatch).length > 0) {
    console.log('\nUpdating Job Listings DB schema...');
    await notion.databases.update({
      database_id: jobListingsDbId,
      properties: schemaPatch,
    });
    console.log('  Schema updated.');
  } else {
    console.log('\nSchema already matches the expected shape.');
  }

  console.log('\nRewriting Date Posted values as text...');
  let updated = 0;
  let repairedFallbacks = 0;

  for (const page of pageUpdates) {
    await notion.pages.update({
      page_id: page.id,
      properties: {
        'Date Posted': {
          rich_text: [{ text: { content: page.datePosted || 'Not Posted' } }],
        },
      },
    });

    updated++;

    if (page.datePosted === 'Not Posted' && page.createdDay === KNOWN_BAD_FALLBACK_DATE) {
      repairedFallbacks++;
    }

    if (updated % 10 === 0) {
      console.log(`  ... ${updated}/${pageUpdates.length} rows updated`);
    }

    await new Promise(resolve => setTimeout(resolve, 350));
  }

  console.log(`  ✓ Rewrote ${updated} rows`);
  console.log(`  ✓ Preserved real date values and backfilled missing dates to "Not Posted"`);
  if (repairedFallbacks > 0) {
    console.log(`  ✓ Repaired ${repairedFallbacks} rows from the known fake fallback date`);
  }
}

(async () => {
  try {
    await main();
    console.log('\nRepair complete.');
  } catch (err) {
    console.error('\nRepair failed:', err.message);
    process.exit(1);
  }
})();
