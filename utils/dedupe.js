'use strict';

/**
 * utils/dedupe.js
 *
 * Fingerprinting and multi-tier job filtering utilities used by the scraper
 * orchestrator to deduplicate and quality-gate job listings before they reach
 * Notion.
 */

const crypto = require('node:crypto');

// ─── Fingerprinting ───────────────────────────────────────────────────────────

/**
 * Generates a deterministic SHA-256 fingerprint for a job listing.
 *
 * Normalizes company + title + location (lowercase, trimmed) before hashing so
 * that minor formatting differences (e.g. trailing spaces, mixed case) do not
 * produce duplicate Notion pages for the same role.
 *
 * @param {string} company   - Hiring company name
 * @param {string} title     - Job title
 * @param {string} location  - Job location
 * @returns {string} 64-character lowercase hex digest
 */
function generateFingerprint(company, title, location) {
  const normalized = [company, title, location]
    .map(s => (s || '').toLowerCase().trim())
    .join('|');

  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// ─── Filtering ────────────────────────────────────────────────────────────────

/**
 * Runs all four filter tiers against a raw job object.
 *
 * Tier 1 — Title match (always enforced):
 *   job.title must case-insensitively contain at least one string from
 *   config.jobTitles, and must not contain any string from
 *   config.blockedJobTitles. Jobs whose titles don't match are dropped
 *   immediately.
 *
 * Tier 2 — Keyword match (enforced only when listing text is present):
 *   job title / description / card text / company context must contain at
 *   least one string from config.keywords. When all of that listing text is
 *   missing or empty the check is skipped so thin sources are not discarded.
 *
 * Tier 3 — Exclude keyword (enforced only when listing text is present):
 *   Combined listing text must NOT contain any string from
 *   config.excludeKeywords. Same skip-when-absent logic as Tier 2.
 *
 * Tier 4 — Location match (enforced only when config.preferredLocations is non-empty):
 *   job.location must case-insensitively contain at least one string from
 *   config.preferredLocations.  Exception: any location containing "remote"
 *   automatically passes, regardless of the preferred list.  Skipped entirely
 *   when config.preferredLocations is an empty array.
 *
 * @param {object} job     - Raw job object with at least { title, location, description }
 * @param {object} config  - Full user config
 * @returns {{ pass: boolean, failedTier: number|null }}
 *   pass        — true if the job should be written to Notion
 *   failedTier  — 1–4 indicating the first tier that rejected the job, or null on pass
 */
function applyFilters(job, config) {
  const title = (job.title || '').toLowerCase();
  const location = (job.location || '').toLowerCase();
  const listingText = [
    job.title,
    job.description,
    job.cardText,
    job.companyContext,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  const blockedTitle = config.blockedJobTitles || [];
  const blockedByTitle = blockedTitle.some(
    t => title.includes(t.toLowerCase())
  );
  if (blockedByTitle) return { pass: false, failedTier: 1 };

  // ── Tier 1: title must match at least one target job title ──────────────────
  const passesTier1 = (config.jobTitles || []).some(
    t => title.includes(t.toLowerCase())
  );
  if (!passesTier1) return { pass: false, failedTier: 1 };

  // ── Tiers 2 & 3 require listing text — skip if unavailable ─────────────────
  if (listingText) {
    // ── Tier 2: at least one keyword must appear in the description ────────────
    const passesTier2 = (config.keywords || []).some(
      k => listingText.includes(k.toLowerCase())
    );
    if (!passesTier2) return { pass: false, failedTier: 2 };

    // ── Tier 3: no exclude keyword may appear in the description ──────────────
    const failsTier3 = (config.excludeKeywords || []).some(
      k => listingText.includes(k.toLowerCase())
    );
    if (failsTier3) return { pass: false, failedTier: 3 };
  }

  // ── Tier 4: location must match a preferred location (or be remote/blank) ───
  const preferred = config.preferredLocations || [];
  if (preferred.length > 0) {
    // Empty/null location passes — a missing location often means remote-friendly.
    const isBlank  = !location;
    const isRemote = location.includes('remote');

    const passesTier4 = isBlank || isRemote || preferred.some(
      p => location.includes(p.toLowerCase())
    );
    if (!passesTier4) return { pass: false, failedTier: 4 };
  }

  return { pass: true, failedTier: null };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { generateFingerprint, applyFilters };
