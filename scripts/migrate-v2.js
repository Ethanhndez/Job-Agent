'use strict';

/**
 * scripts/migrate-v2.js
 *
 * One-time migration for the Job Listings DB:
 *   1. Rename "Title"      → "Job Title"
 *   2. Rename "Date Found" → "Date Posted"
 *   3. Delete "Cover Letter" property
 *   4. Delete "Resume Version" property
 *   5. Store "Date Posted" as rich text
 *   6. Backfill all pages where Salary is blank → "Not listed"
 *
 * Run once: node scripts/migrate-v2.js
 */

require('dotenv').config();
const { Client } = require('@notionhq/client');
const fs         = require('node:fs');
const path       = require('node:path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'notion.config.json');
const { jobListingsDbId } = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// ─── Step 1-4: Schema changes ─────────────────────────────────────────────────

async function updateSchema() {
  console.log('Updating Job Listings DB schema…');

  await notion.databases.update({
    database_id: jobListingsDbId,
    properties: {
      // Rename title column
      'Title': { name: 'Job Title' },
      // Rename and convert the posted-date column to rich text
      'Date Found': { name: 'Date Posted', rich_text: {} },
      // Remove Job Listings-only columns (Applications DB keeps its own copies)
      'Cover Letter':   null,
      'Resume Version': null,
    },
  });

  console.log('  ✓ "Title" → "Job Title"');
  console.log('  ✓ "Date Found" → "Date Posted" (rich text)');
  console.log('  ✓ "Cover Letter" removed');
  console.log('  ✓ "Resume Version" removed');
}

// ─── Step 5: Backfill empty Salary → "Not listed" ────────────────────────────

async function backfillSalary() {
  console.log('\nQuerying pages with blank Salary…');

  const pages = [];
  let cursor;

  do {
    const res = await notion.databases.query({
      database_id: jobListingsDbId,
      filter: {
        property: 'Salary',
        rich_text: { is_empty: true },
      },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);

  console.log(`  Found ${pages.length} pages with blank Salary.`);
  if (pages.length === 0) return;

  let updated = 0;
  for (const page of pages) {
    await notion.pages.update({
      page_id: page.id,
      properties: {
        'Salary': { rich_text: [{ text: { content: 'Not listed' } }] },
      },
    });
    updated++;
    if (updated % 10 === 0) console.log(`  … ${updated}/${pages.length} updated`);
    // Brief pause to stay within Notion rate limits (3 req/s).
    await new Promise(r => setTimeout(r, 350));
  }

  console.log(`  ✓ ${updated} pages backfilled with "Not listed"`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  try {
    await updateSchema();
    await backfillSalary();
    console.log('\nMigration complete.');
  } catch (err) {
    console.error('\nMigration failed:', err.message);
    process.exit(1);
  }
})();
