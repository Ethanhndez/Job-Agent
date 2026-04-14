'use strict';

/**
 * setup.js
 *
 * First-time setup wizard. Run once with: node setup.js
 *
 * What it does:
 *   1. Validates required environment variables
 *   2. Tests the Notion API connection
 *   3. Checks whether the "Job Agent" workspace already exists
 *   4. Creates the root page + both databases if they don't exist
 *   5. Writes database IDs to config/notion.config.json
 */

require('dotenv').config();
const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');

// ─── Constants ────────────────────────────────────────────────────────────────

const ROOT_PAGE_TITLE   = 'Job Agent';
const JOB_LISTINGS_TITLE = 'Job Listings DB';
const APPLICATIONS_TITLE  = 'Applications DB';
const CONFIG_OUT_PATH = path.join(__dirname, 'config', 'notion.config.json');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Print a labelled step header */
function step(n, label) {
  console.log(`\n[${n}] ${label}`);
}

/** Print an indented status line */
function info(msg) {
  console.log(`    ${msg}`);
}

/** Print a success line */
function ok(msg) {
  console.log(`    ✓ ${msg}`);
}

/** Print an error and exit non-zero */
function fatal(msg) {
  console.error(`\n  ERROR: ${msg}\n`);
  process.exit(1);
}

// ─── Step 1: Validate environment variables ───────────────────────────────────

step(1, 'Checking environment variables…');

const NOTION_TOKEN          = process.env.NOTION_TOKEN;
const NOTION_PARENT_PAGE_ID = process.env.NOTION_PARENT_PAGE_ID;
const ANTHROPIC_API_KEY     = process.env.ANTHROPIC_API_KEY;

const missing = [];
if (!NOTION_TOKEN)          missing.push('NOTION_TOKEN');
if (!NOTION_PARENT_PAGE_ID) missing.push('NOTION_PARENT_PAGE_ID');
if (!ANTHROPIC_API_KEY)     missing.push('ANTHROPIC_API_KEY');

if (missing.length > 0) {
  fatal(
    `The following required environment variables are not set:\n\n` +
    missing.map(k => `      • ${k}`).join('\n') +
    `\n\n  Copy .env.example to .env and fill in the missing values.`
  );
}

ok('NOTION_TOKEN found');
ok('NOTION_PARENT_PAGE_ID found');
ok('ANTHROPIC_API_KEY found');

// ─── Notion client ────────────────────────────────────────────────────────────

const notion = new Client({ auth: NOTION_TOKEN });

// ─── Main async flow ──────────────────────────────────────────────────────────

async function main() {

  // ── Step 2: Test Notion API connection ──────────────────────────────────────

  step(2, 'Testing Notion API connection…');

  let parentPage;
  try {
    parentPage = await notion.pages.retrieve({ page_id: NOTION_PARENT_PAGE_ID });
    ok(`Connected. Parent page found: "${getPageTitle(parentPage)}"`);
  } catch (err) {
    if (err.code === 'object_not_found') {
      fatal(
        `Notion page "${NOTION_PARENT_PAGE_ID}" was not found.\n\n` +
        `  Possible causes:\n` +
        `    • The page ID in NOTION_PARENT_PAGE_ID is incorrect.\n` +
        `    • The page has not been shared with your integration.\n\n` +
        `  Fix: open the page in Notion → Share → Invite → select your integration.`
      );
    }
    if (err.code === 'unauthorized') {
      fatal(
        `Notion returned 401 Unauthorized.\n\n` +
        `  Your NOTION_TOKEN is invalid or has been revoked.\n` +
        `  Get a fresh token at: https://www.notion.so/my-integrations`
      );
    }
    fatal(`Notion API error: ${err.message}`);
  }

  // ── Step 3: Check whether the workspace already exists ──────────────────────

  step(3, `Checking for existing "${ROOT_PAGE_TITLE}" workspace…`);

  const existingRootId = await findChildPageByTitle(NOTION_PARENT_PAGE_ID, ROOT_PAGE_TITLE);

  if (existingRootId) {
    console.log(
      `\n  The "${ROOT_PAGE_TITLE}" workspace already exists under this parent page.\n` +
      `  Page ID: ${existingRootId}\n\n` +
      `  Nothing was changed. If you want to recreate the workspace,\n` +
      `  delete the existing "${ROOT_PAGE_TITLE}" page in Notion and run setup again.\n`
    );
    process.exit(0);
  }

  ok(`No existing workspace found — proceeding with creation.`);

  // ── Step 4: Create root page ─────────────────────────────────────────────────

  step(4, `Creating root page "${ROOT_PAGE_TITLE}"…`);

  let rootPage;
  try {
    rootPage = await notion.pages.create({
      parent: { page_id: NOTION_PARENT_PAGE_ID },
      properties: {
        title: {
          title: [{ text: { content: ROOT_PAGE_TITLE } }],
        },
      },
      icon: { type: 'emoji', emoji: '📁' },
    });
    ok(`Root page created. ID: ${rootPage.id}`);
  } catch (err) {
    fatal(`Failed to create root page: ${err.message}`);
  }

  // ── Step 4b: Append formatted content blocks to the root page ──────────────

  step('4b', 'Adding content blocks to root page…');

  try {
    await notion.blocks.children.append({
      block_id: rootPage.id,
      children: buildRootPageBlocks(),
    });
    ok('Content blocks appended.');
  } catch (err) {
    // Non-fatal — the databases are more important than the page design.
    info(`Warning: could not append content blocks (${err.message}). Continuing.`);
  }

  // ── Step 5: Create Job Listings DB ───────────────────────────────────────────

  step(5, `Creating "${JOB_LISTINGS_TITLE}" database…`);

  let jobListingsDb;
  try {
    jobListingsDb = await notion.databases.create({
      parent: { page_id: rootPage.id },
      title: [{ text: { content: JOB_LISTINGS_TITLE } }],
      icon: { type: 'emoji', emoji: '📊' },
      properties: {
        // Primary key — Notion requires exactly one "title" property
        'Job Title': {
          title: {},
        },
        'Company': {
          rich_text: {},
        },
        'Location': {
          rich_text: {},
        },
        'Salary': {
          rich_text: {},
        },
        'Source URL': {
          url: {},
        },
        'Date Posted': {
          date: {},
        },
        'Status': {
          select: {
            options: [
              { name: 'New',          color: 'blue'   },
              { name: 'Reviewing',    color: 'yellow' },
              { name: 'Apply',        color: 'orange' },
              { name: 'Applied',      color: 'green'  },
              { name: 'Interviewing', color: 'purple' },
              { name: 'Rejected',     color: 'red'    },
              { name: 'Offer',        color: 'pink'   },
            ],
          },
        },
        'Applied Date': {
          date: {},
        },
        // Fingerprint is a hash used for deduplication — stored as plain text
        'Fingerprint': {
          rich_text: {},
        },
      },
    });
    ok(`"${JOB_LISTINGS_TITLE}" created. ID: ${jobListingsDb.id}`);
  } catch (err) {
    fatal(`Failed to create Job Listings DB: ${err.message}`);
  }

  // ── Step 6: Create Applications DB ───────────────────────────────────────────

  step(6, `Creating "${APPLICATIONS_TITLE}" database…`);

  let applicationsDb;
  try {
    applicationsDb = await notion.databases.create({
      parent: { page_id: rootPage.id },
      title: [{ text: { content: APPLICATIONS_TITLE } }],
      icon: { type: 'emoji', emoji: '📊' },
      properties: {
        // Primary key — company name serves as the record label
        'Company': {
          title: {},
        },
        'Role': {
          rich_text: {},
        },
        'Location': {
          rich_text: {},
        },
        'Date Applied': {
          date: {},
        },
        'Resume Version': {
          rich_text: {},
        },
        'Cover Letter': {
          checkbox: {},
        },
        'Status': {
          rich_text: {},
        },
        'Notion URL': {
          url: {},
        },
      },
    });
    ok(`"${APPLICATIONS_TITLE}" created. ID: ${applicationsDb.id}`);
  } catch (err) {
    fatal(`Failed to create Applications DB: ${err.message}`);
  }

  // ── Step 7: Write config/notion.config.json ───────────────────────────────────

  step(7, `Writing config/notion.config.json…`);

  const notionConfig = {
    rootPageId:        rootPage.id,
    jobListingsDbId:   jobListingsDb.id,
    applicationsDbId:  applicationsDb.id,
  };

  try {
    fs.mkdirSync(path.dirname(CONFIG_OUT_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_OUT_PATH, JSON.stringify(notionConfig, null, 2) + '\n', 'utf8');
    ok(`Saved to ${CONFIG_OUT_PATH}`);
  } catch (err) {
    fatal(`Could not write ${CONFIG_OUT_PATH}: ${err.message}`);
  }

  // ── Success summary ───────────────────────────────────────────────────────────

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Setup complete!

  Root page        "${ROOT_PAGE_TITLE}"     ${rootPage.id}
  Job Listings DB  "${JOB_LISTINGS_TITLE}"  ${jobListingsDb.id}
  Applications DB  "${APPLICATIONS_TITLE}"  ${applicationsDb.id}

  IDs saved to: config/notion.config.json

  Next step: add your resume to /resume/ then run  npm start
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

// ─── Root page content ────────────────────────────────────────────────────────

/**
 * Builds the array of Notion block objects that populate the "Job Agent" root
 * page with structured documentation.  Extracted into a function so it can be
 * shared with scripts/updateNotionPage.js.
 *
 * @returns {Array} Notion block objects ready for blocks.children.append
 */
function buildRootPageBlocks() {
  const h1 = text => ({
    object: 'block', type: 'heading_1',
    heading_1: { rich_text: [{ type: 'text', text: { content: text } }] },
  });

  const h2 = text => ({
    object: 'block', type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: text } }] },
  });

  const p = text => ({
    object: 'block', type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: text } }] },
  });

  const divider = () => ({ object: 'block', type: 'divider', divider: {} });

  const bullet = text => ({
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: text } }] },
  });

  return [
    // ── Header ──────────────────────────────────────────────────────────────
    h1('Job Agent'),
    p(
      'An agent-based job search automation system for AI/ML engineers. ' +
      'Scrapes 7 job boards weekly, filters listings by title, keywords, and location, ' +
      'and generates tailored resumes and cover letters using Claude AI.'
    ),
    divider(),

    // ── How It Works ────────────────────────────────────────────────────────
    h2('How It Works'),
    bullet('Scrape — GitHub Actions runs every Sunday at 8am. Playwright visits 7 job boards and pulls matching listings.'),
    bullet('Filter — 3-tier filter (title → keywords → location) keeps only relevant roles.'),
    bullet('Organize — New jobs are written to the Job Listings DB below. Duplicates are automatically skipped.'),
    bullet('Review — Browse the Job Listings DB, change Status to Apply on roles you want to pursue.'),
    bullet('Apply — Run node apply.js. Claude reads each job description and generates a tailored resume and cover letter.'),
    bullet('Track — Every application is logged to applications.xlsx and the Applications DB.'),
    divider(),

    // ── Status Progression ───────────────────────────────────────────────────
    h2('Status Progression'),
    p('New → Reviewing → Apply → Applied → Interviewing → Rejected → Offer'),
    divider(),

    // ── Tech Stack ───────────────────────────────────────────────────────────
    h2('Tech Stack'),
    bullet('Scheduler: GitHub Actions'),
    bullet('Scraping: Playwright (Chromium)'),
    bullet('LLM: Claude via Anthropic SDK'),
    bullet('Workspace: Notion API'),
    bullet('Resume parsing: pdf-parse + mammoth'),
    bullet('Resume output: docx'),
    bullet('Excel tracking: exceljs'),
    divider(),

    // ── Job Sources ──────────────────────────────────────────────────────────
    h2('Job Sources (v1.0)'),
    bullet('Wellfound'),
    bullet('Greenhouse'),
    bullet('Lever'),
    bullet('Ashby'),
    bullet('Built In Austin'),
    bullet('Built In Houston'),
    bullet('YC Jobs'),
  ];
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Extract the plain-text title from a Notion page object.
 * Returns an empty string if the title can't be read.
 */
function getPageTitle(page) {
  try {
    const titleProp = Object.values(page.properties).find(p => p.type === 'title');
    if (!titleProp) return '';
    return titleProp.title.map(t => t.plain_text).join('');
  } catch (_) {
    return '';
  }
}

/**
 * Search the direct children of parentPageId for a page whose title exactly
 * matches targetTitle. Returns the page ID string if found, or null if not.
 *
 * Uses the Notion search API filtered by page type, then checks the parent.
 * Notion's block-children endpoint returns blocks, not pages, so search is
 * the most reliable way to find child pages by title.
 */
async function findChildPageByTitle(parentPageId, targetTitle) {
  try {
    let cursor;
    do {
      const response = await notion.search({
        query: targetTitle,
        filter: { property: 'object', value: 'page' },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });

      for (const result of response.results) {
        // Must be a direct child of our parent page
        const parent = result.parent;
        if (!parent) continue;

        const isDirectChild =
          (parent.type === 'page_id' && parent.page_id === parentPageId) ||
          (parent.type === 'workspace');

        if (!isDirectChild) continue;

        const title = getPageTitle(result);
        if (title === targetTitle) return result.id;
      }

      cursor = response.has_more ? response.next_cursor : null;
    } while (cursor);

    return null;
  } catch (err) {
    // Non-fatal — if search fails we'll just proceed with creation
    info(`Warning: could not search for existing pages (${err.message}). Proceeding.`);
    return null;
  }
}

// ─── Exports (for scripts/updateNotionPage.js) ───────────────────────────────

module.exports = { buildRootPageBlocks };

// ─── Run ─────────────────────────────────────────────────────────────────────

// Guard so that requiring this file from another script does not re-run setup.
if (require.main === module) {
  main().catch(err => fatal(`Unexpected error: ${err.message}`));
}
