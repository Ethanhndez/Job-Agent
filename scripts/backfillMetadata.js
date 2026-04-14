'use strict';

require('dotenv').config();

const { Client } = require('@notionhq/client');

const {
  loadNotionConfig,
  ensureJobListingsSchema,
} = require('../agents/notionWriter');
const {
  VALID_EMPLOYMENT_TYPES,
  VALID_EXPERIENCE_LEVELS,
  classifyEmploymentType,
  classifyExperienceLevel,
} = require('../utils/jobClassifier');

function getTitleValue(property) {
  if (!property || property.type !== 'title') {
    return '';
  }

  return property.title
    .map(item => item.plain_text || '')
    .join('')
    .trim();
}

function getRichTextValue(property) {
  if (!property || property.type !== 'rich_text') {
    return '';
  }

  return property.rich_text
    .map(item => item.plain_text || '')
    .join('')
    .trim();
}

function getSelectValue(property) {
  if (!property || property.type !== 'select' || !property.select) {
    return '';
  }

  return property.select.name || '';
}

function isBlankOrInvalid(value, validValues) {
  return !value || !validValues.has(value);
}

function buildJobFromPage(page) {
  const properties = page.properties || {};

  return {
    title: getTitleValue(properties['Job Title']),
    company: getRichTextValue(properties['Company']),
    location: getRichTextValue(properties['Location']),
    cardText: [
      getTitleValue(properties['Job Title']),
      getRichTextValue(properties['Company']),
      getRichTextValue(properties['Location']),
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

async function fetchAllJobPages(notionClient, dbId) {
  const pages = [];
  let cursor;

  do {
    const response = await notionClient.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
    });

    pages.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return pages;
}

async function main() {
  if (!process.env.NOTION_TOKEN) {
    throw new Error('NOTION_TOKEN is not set. Add it to your .env file.');
  }

  const notionClient = new Client({ auth: process.env.NOTION_TOKEN });
  const notionConfig = loadNotionConfig();
  const dbId = notionConfig.jobListingsDbId;

  await ensureJobListingsSchema(notionClient, dbId);

  const pages = await fetchAllJobPages(notionClient, dbId);
  const stats = {
    scanned: pages.length,
    updated: 0,
    employmentTypeUpdated: 0,
    experienceLevelUpdated: 0,
    unchanged: 0,
  };

  console.log(`backfillMetadata: scanning ${pages.length} Job Listings rows`);

  for (const page of pages) {
    const properties = page.properties || {};
    const currentEmploymentType = getSelectValue(properties['Employment Type']);
    const currentExperienceLevel = getSelectValue(properties['Experience Level']);
    const job = buildJobFromPage(page);
    const nextEmploymentType = classifyEmploymentType(job);
    const nextExperienceLevel = classifyExperienceLevel(job);

    const updateProperties = {};

    if (isBlankOrInvalid(currentEmploymentType, VALID_EMPLOYMENT_TYPES)) {
      updateProperties['Employment Type'] = {
        select: { name: nextEmploymentType },
      };
      stats.employmentTypeUpdated++;
    }

    if (isBlankOrInvalid(currentExperienceLevel, VALID_EXPERIENCE_LEVELS)) {
      updateProperties['Experience Level'] = {
        select: { name: nextExperienceLevel },
      };
      stats.experienceLevelUpdated++;
    }

    if (Object.keys(updateProperties).length === 0) {
      stats.unchanged++;
      continue;
    }

    await notionClient.pages.update({
      page_id: page.id,
      properties: updateProperties,
    });

    stats.updated++;
    console.log(
      `  updated — ${job.title || page.id} ` +
      `(employment: ${currentEmploymentType || 'blank'} → ${nextEmploymentType}, ` +
      `experience: ${currentExperienceLevel || 'blank'} → ${nextExperienceLevel})`
    );
  }

  console.log('\nbackfillMetadata complete');
  console.log(`  scanned rows              : ${stats.scanned}`);
  console.log(`  rows updated              : ${stats.updated}`);
  console.log(`  Employment Type backfills : ${stats.employmentTypeUpdated}`);
  console.log(`  Experience Level backfills: ${stats.experienceLevelUpdated}`);
  console.log(`  unchanged rows            : ${stats.unchanged}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`backfillMetadata failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  buildJobFromPage,
  fetchAllJobPages,
};
