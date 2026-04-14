'use strict';

/**
 * scripts/updateNotionPage.js
 *
 * One-time script that appends the full formatted content block set to the
 * existing "Job Agent" root page without touching the databases inside it.
 *
 * Usage:
 *   node scripts/updateNotionPage.js
 *
 * Reads rootPageId from config/notion.config.json and NOTION_TOKEN from .env.
 */

require('dotenv').config();

const { Client } = require('@notionhq/client');
const fs         = require('node:fs');
const path       = require('node:path');

// Re-use the block builder from setup.js so the content stays in sync.
const { buildRootPageBlocks } = require('../setup');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'notion.config.json');

async function main() {
  // ── Load Notion config ────────────────────────────────────────────────────
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('config/notion.config.json not found. Run node setup.js first.');
    process.exit(1);
  }

  const { rootPageId } = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  if (!rootPageId) {
    console.error('rootPageId missing from config/notion.config.json.');
    process.exit(1);
  }

  if (!process.env.NOTION_TOKEN) {
    console.error('NOTION_TOKEN is not set. Add it to your .env file.');
    process.exit(1);
  }

  const notion = new Client({ auth: process.env.NOTION_TOKEN });

  // ── Append blocks ─────────────────────────────────────────────────────────
  console.log(`Appending content blocks to root page: ${rootPageId}`);

  try {
    await notion.blocks.children.append({
      block_id: rootPageId,
      children: buildRootPageBlocks(),
    });
    console.log('Done. Open the "Job Agent" page in Notion to see the updated layout.');
  } catch (err) {
    console.error(`Failed to append blocks: ${err.message}`);
    process.exit(1);
  }
}

main();
