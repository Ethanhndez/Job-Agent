'use strict';

/**
 * agents/notionWriter.js
 *
 * Handles all writes and reads to the Notion workspace created by setup.js.
 * Every exported function receives a pre-constructed Notion Client so callers
 * control auth; this module never reads env vars directly.
 *
 * Exported functions:
 *   loadNotionConfig()
 *   ensureJobListingsSchema(notionClient, dbId)
 *   jobExistsByUrl(notionClient, dbId, url)
 *   jobExistsByFingerprint(notionClient, dbId, fingerprint)
 *   createJobPage(notionClient, dbId, job)
 *   updateJobStatus(notionClient, dbId, pageId, status)
 *   getJobsWithStatus(notionClient, dbId, status)
 *   createApplicationEntry(notionClient, appDbId, application)
 */

const fs   = require('node:fs');
const path = require('node:path');
const {
  EMPLOYMENT_TYPE_OPTIONS,
  EXPERIENCE_LEVEL_OPTIONS,
} = require('../utils/jobClassifier');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'notion.config.json');

// ─── Config loader ────────────────────────────────────────────────────────────

/**
 * Reads config/notion.config.json and returns the parsed object.
 *
 * Throws a descriptive error if the file doesn't exist so callers can give
 * the user a clear next step.
 *
 * @returns {{ rootPageId: string, jobListingsDbId: string, applicationsDbId: string }}
 */
function loadNotionConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `config/notion.config.json not found.\n` +
      `Run  node setup.js  first to create your Notion workspace and generate this file.`
    );
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse config/notion.config.json: ${err.message}`);
  }
}

// ─── Schema checks ────────────────────────────────────────────────────────────

/**
 * Ensures the Job Listings DB contains the expected select property used by
 * the current scraper pipeline.
 *
 * @param {import('@notionhq/client').Client} notionClient
 * @param {string} dbId
 * @returns {Promise<void>}
 */
async function ensureJobListingsSchema(notionClient, dbId) {
  try {
    const database = await notionClient.databases.retrieve({ database_id: dbId });
    const employmentType = database.properties['Employment Type'];
    const experienceLevel = database.properties['Experience Level'];

    const schemaPatch = {};

    const employmentPatch = buildSelectPropertyPatch(
      employmentType,
      EMPLOYMENT_TYPE_OPTIONS
    );
    if (employmentPatch) {
      schemaPatch['Employment Type'] = employmentPatch;
    }

    const experiencePatch = buildSelectPropertyPatch(
      experienceLevel,
      EXPERIENCE_LEVEL_OPTIONS
    );
    if (experiencePatch) {
      schemaPatch['Experience Level'] = experiencePatch;
    }

    if (Object.keys(schemaPatch).length === 0) {
      return;
    }

    await notionClient.databases.update({
      database_id: dbId,
      properties: schemaPatch,
    });
  } catch (err) {
    throw new Error(`ensureJobListingsSchema: failed to verify Job Listings schema — ${err.message}`);
  }
}

function buildSelectPropertyPatch(property, desiredOptions) {
  if (property?.type !== 'select') {
    return {
      select: {
        options: desiredOptions,
      },
    };
  }

  const currentOptions = property.select.options || [];
  const optionsByName = new Map(
    currentOptions.map(option => [option.name, option])
  );

  const needsUpdate = desiredOptions.some(option => {
    const current = optionsByName.get(option.name);
    return !current || current.color !== option.color;
  });

  if (!needsUpdate) {
    return null;
  }

  return {
    select: {
      options: desiredOptions.map(option => {
        const current = optionsByName.get(option.name);
        if (current?.id) {
          return { id: current.id, name: option.name, color: option.color };
        }

        return option;
      }),
    },
  };
}

// ─── Deduplication checks ─────────────────────────────────────────────────────

/**
 * Deduplication pass 1 — checks whether a job with the given source URL
 * already exists in the Job Listings DB.
 *
 * Queries the "Source URL" property for an exact match.
 * Returns true if a matching page is found, false otherwise.
 *
 * @param {import('@notionhq/client').Client} notionClient
 * @param {string} dbId  - Job Listings DB ID
 * @param {string} url   - The source URL to look up
 * @returns {Promise<boolean>}
 */
async function jobExistsByUrl(notionClient, dbId, url) {
  try {
    const response = await notionClient.databases.query({
      database_id: dbId,
      filter: {
        property: 'Source URL',
        url: { equals: url },
      },
      page_size: 1,
    });

    return response.results.length > 0;
  } catch (err) {
    throw new Error(`jobExistsByUrl: Notion query failed — ${err.message}`);
  }
}

/**
 * Deduplication pass 2 — checks whether a job with the given fingerprint hash
 * already exists in the Job Listings DB.
 *
 * Useful when the same listing appears at a different URL (e.g. Greenhouse
 * cross-posts). Returns true if a match is found, false otherwise.
 *
 * @param {import('@notionhq/client').Client} notionClient
 * @param {string} dbId         - Job Listings DB ID
 * @param {string} fingerprint  - Hash string produced by dedupe.js
 * @returns {Promise<boolean>}
 */
async function jobExistsByFingerprint(notionClient, dbId, fingerprint) {
  try {
    const response = await notionClient.databases.query({
      database_id: dbId,
      filter: {
        property: 'Fingerprint',
        rich_text: { equals: fingerprint },
      },
      page_size: 1,
    });

    return response.results.length > 0;
  } catch (err) {
    throw new Error(`jobExistsByFingerprint: Notion query failed — ${err.message}`);
  }
}

// ─── Job page creation ────────────────────────────────────────────────────────

/**
 * Creates a new page in the Job Listings DB for a single job listing.
 *
 * Sets Status to "New" automatically. Returns the ID of the created page.
 *
 * Expected job shape:
 *   {
 *     title:       string,  // job title shown as the page name
 *     company:     string,
 *     location:    string,
 *     salary:      string,  // empty string if not available
 *     sourceUrl:   string,
 *     employmentType: string, // Internship | Full-Time | Unknown
 *     experienceLevel: string, // Internship | Entry Level | Associate | Mid Level | Senior | Staff+ | Unknown
 *     fingerprint: string,  // hash from dedupe.js
 *   }
 *
 * @param {import('@notionhq/client').Client} notionClient
 * @param {string} dbId
 * @param {object} job
 * @returns {Promise<string>} The created page ID
 */
async function createJobPage(notionClient, dbId, job) {
  try {
    const page = await notionClient.pages.create({
      parent: { database_id: dbId },
      properties: {
        'Job Title': {
          title: [{ text: { content: job.title } }],
        },
        'Company': {
          rich_text: [{ text: { content: job.company } }],
        },
        'Location': {
          rich_text: [{ text: { content: job.location } }],
        },
        'Salary': {
          rich_text: [{ text: { content: job.salary || 'Not listed' } }],
        },
        'Source URL': {
          url: job.sourceUrl,
        },
        'Employment Type': {
          select: { name: job.employmentType || 'Unknown' },
        },
        'Experience Level': {
          select: { name: job.experienceLevel || 'Unknown' },
        },
        'Status': {
          select: { name: 'New' },
        },
        'Fingerprint': {
          rich_text: [{ text: { content: job.fingerprint } }],
        },
      },
    });

    return page.id;
  } catch (err) {
    throw new Error(
      `createJobPage: failed to create page for "${job.title}" at ${job.company} — ${err.message}`
    );
  }
}

// ─── Status management ────────────────────────────────────────────────────────

/**
 * Updates the Status select field on a Job Listings DB page.
 *
 * Valid status values (must match options created by setup.js):
 *   "New" | "Reviewing" | "Apply" | "Applied" | "Interviewing" | "Rejected" | "Offer"
 *
 * @param {import('@notionhq/client').Client} notionClient
 * @param {string} dbId    - Job Listings DB ID (unused here but kept for call-site symmetry)
 * @param {string} pageId  - ID of the job page to update
 * @param {string} status  - New status value
 * @returns {Promise<void>}
 */
async function updateJobStatus(notionClient, _dbId, pageId, status) {
  try {
    await notionClient.pages.update({
      page_id: pageId,
      properties: {
        'Status': {
          select: { name: status },
        },
      },
    });
  } catch (err) {
    throw new Error(
      `updateJobStatus: failed to set status "${status}" on page ${pageId} — ${err.message}`
    );
  }
}

// ─── Querying ─────────────────────────────────────────────────────────────────

/**
 * Returns all Job Listings DB pages whose Status equals the given value.
 *
 * Handles Notion's 100-page pagination automatically — keeps fetching until
 * all matching pages have been collected.
 *
 * Used by apply.js to retrieve jobs the user has marked "Apply".
 *
 * @param {import('@notionhq/client').Client} notionClient
 * @param {string} dbId    - Job Listings DB ID
 * @param {string} status  - Status value to filter by, e.g. "Apply"
 * @returns {Promise<Array>} Array of raw Notion page objects
 */
async function getJobsWithStatus(notionClient, dbId, status) {
  const pages = [];
  let cursor;

  try {
    do {
      const response = await notionClient.databases.query({
        database_id: dbId,
        filter: {
          property: 'Status',
          select: { equals: status },
        },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });

      pages.push(...response.results);
      cursor = response.has_more ? response.next_cursor : null;
    } while (cursor);
  } catch (err) {
    throw new Error(
      `getJobsWithStatus: failed to query for status "${status}" — ${err.message}`
    );
  }

  return pages;
}

// ─── Application entries ──────────────────────────────────────────────────────

/**
 * Creates a new page in the Applications DB recording a completed application.
 *
 * Expected application shape:
 *   {
 *     company:       string,
 *     role:          string,
 *     location:      string,
 *     dateApplied:   string,   // ISO 8601 date string
 *     resumeVersion: string,   // e.g. "resume-acme-v2.pdf"
 *     coverLetter:   boolean,
 *     status:        string,   // e.g. "Submitted", "Pending"
 *     notionUrl:     string,   // URL of the corresponding Job Listings page
 *   }
 *
 * @param {import('@notionhq/client').Client} notionClient
 * @param {string} appDbId      - Applications DB ID
 * @param {object} application
 * @returns {Promise<string>} The created page ID
 */
async function createApplicationEntry(notionClient, appDbId, application) {
  try {
    const page = await notionClient.pages.create({
      parent: { database_id: appDbId },
      properties: {
        'Company': {
          title: [{ text: { content: application.company } }],
        },
        'Role': {
          rich_text: [{ text: { content: application.role } }],
        },
        'Location': {
          rich_text: [{ text: { content: application.location } }],
        },
        'Date Applied': {
          date: { start: application.dateApplied },
        },
        'Resume Version': {
          rich_text: [{ text: { content: application.resumeVersion } }],
        },
        'Cover Letter': {
          checkbox: application.coverLetter,
        },
        'Status': {
          rich_text: [{ text: { content: application.status } }],
        },
        'Notion URL': {
          url: application.notionUrl,
        },
      },
    });

    return page.id;
  } catch (err) {
    throw new Error(
      `createApplicationEntry: failed to create entry for "${application.role}" ` +
      `at ${application.company} — ${err.message}`
    );
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  loadNotionConfig,
  ensureJobListingsSchema,
  jobExistsByUrl,
  jobExistsByFingerprint,
  createJobPage,
  updateJobStatus,
  getJobsWithStatus,
  createApplicationEntry,
};
