# job-agent — Session Memory

Read this file at the start of every session. Then read the files relevant to the task before making changes. Keep edits local and aligned with the current architecture.

---

## 1. Project Overview

job-agent is a Node.js automation system for technical job discovery and review. It currently:

1. Scrapes job listings from multiple sources sequentially
2. Filters for broader CIS-relevant technical roles
3. Deduplicates by source URL and SHA-256 fingerprint
4. Syncs surviving listings into a Notion Job Listings database
5. Classifies listings with normalized metadata
6. Supports historical metadata backfill for older Notion rows

The project is no longer narrowly AI-only. It now targets a broader CIS-oriented technical search while still including AI/ML roles.

---

## 2. Current Architecture

- **CommonJS only.** Use `require()` and `module.exports`.
- **`async/await` only.** Avoid Promise chains for normal flow.
- **Sequential scraping only.** `agents/scraper.js` runs sources one at a time. Do not parallelize scrapers.
- **Scrapers are raw data sources.** Filtering, classification, dedupe, and Notion writes stay outside scraper files.
- **Shared classifier logic lives in `utils/jobClassifier.js`.**
- **Notion client remains caller-owned.** `agents/notionWriter.js` receives a prebuilt client.
- **Filtering logic remains centralized in `utils/dedupe.js`.**

High-level flow:

1. `index.js` calls `runScraper()` from `agents/scraper.js`
2. Each scraper returns raw jobs
3. Scraper orchestrator assigns metadata via `utils/jobClassifier.js`
4. `utils/dedupe.js` applies the 4-tier filter
5. `agents/notionWriter.js` dedupes and writes to Notion

---

## 3. Active Sources

- Greenhouse
- Lever
- Ashby
- BuiltIn Austin
- BuiltIn Houston
- YC Jobs
- Wellfound — intentionally skipped because authentication is required

Notes:

- Execution remains sequential across all sources.
- Wellfound should continue returning an empty set with a clear skip message unless auth support is intentionally added later.

---

## 4. Current Metadata Fields

### Employment Type

Allowed values:

- `Internship`
- `Full-Time`
- `Unknown`

### Experience Level

Allowed values:

- `Internship`
- `Entry Level`
- `Associate`
- `Mid Level`
- `Senior`
- `Staff+`
- `Unknown`

Classification is descriptive metadata only. It is not intended to be the main filtering control.

---

## 5. Notion Integration Status

Job-Agent currently relies on a Notion workspace created by `setup.js` and updated through `agents/notionWriter.js`.

Current Job Listings DB behavior:

- Ensures normalized `Employment Type` select options
- Ensures normalized `Experience Level` select options
- Normalizes select colors for both metadata fields
- Deduplicates by `Source URL`
- Deduplicates by `Fingerprint`
- Writes normalized metadata for new rows

Historical metadata support:

- `scripts/backfillMetadata.js` scans all Job Listings rows
- Safely paginates through Notion results
- Reclassifies only blank or invalid metadata
- Does not overwrite already-valid values unnecessarily

Backfill quality depends on what text is still available in stored Notion rows. Older rows may only retain title/company/location-level signals.

---

## 6. Visual Intelligence Layer

Notion select colors are normalized for quick scanning.

### Employment Type colors

- `Internship` → `purple`
- `Full-Time` → `green`
- `Unknown` → `gray`

### Experience Level colors

- `Internship` → `purple`
- `Entry Level` → `blue`
- `Associate` → `green`
- `Mid Level` → `yellow`
- `Senior` → `orange`
- `Staff+` → `red`
- `Unknown` → `gray`

These definitions are shared between:

- `utils/jobClassifier.js`
- `setup.js`
- `agents/notionWriter.js`

---

## 7. Filtering Direction

Filtering is now broader and CIS-oriented rather than narrowly AI-only.

Current target categories include:

- software engineering / software development
- full stack / backend / frontend
- data / analytics / BI
- cybersecurity / security engineering
- infrastructure / cloud / devops / SRE
- product engineering
- product design / UX / UI
- solutions / forward deployed / implementation
- AI / ML roles

Important constraints:

- Filtering still runs in `utils/dedupe.js`
- Metadata classification stays separate from filtering
- Internship support is intentional and should be preserved
- Some blunt exclusion logic still exists and can filter out otherwise-relevant roles

---

## 8. Recent Major Upgrades

- Added normalized `Experience Level` metadata
- Expanded filtering to broader CIS-relevant technical roles
- Improved internship and early-career support
- Introduced shared classifier module at `utils/jobClassifier.js`
- Added normalized color-coordinated Notion metadata
- Added `scripts/backfillMetadata.js` for historical metadata repair
- Updated schema ensure logic so existing databases can be normalized in place

---

## 9. Current File Map

Key files relevant to the current scraper/metadata stack:

- `index.js` — entry point for `npm start`
- `setup.js` — first-run Notion workspace/database setup
- `agents/scraper.js` — sequential scraper orchestrator
- `agents/notionWriter.js` — Notion schema ensure, dedupe, and writes
- `utils/dedupe.js` — filter + fingerprint logic
- `utils/jobClassifier.js` — shared Employment Type / Experience Level classification
- `scripts/backfillMetadata.js` — historical metadata backfill
- `config/user.config.js` — local filtering preferences
- `config/user.config.example.js` — config template

Phases 4–6 application logic still exists in the repo but is not part of the current scraping/metadata work unless explicitly requested.

---

## 10. Known Limitations

- Wellfound requires authentication and is skipped by design
- Duplicate-heavy runs can produce zero new writes even when the scraper is healthy
- Historical backfill quality depends on what text is already stored in Notion
- Some filtering tradeoffs remain, especially around blunt exclusion logic
- Broader targeting improves recall but may still need precision tuning by source or role family

---

## 11. Recommended Next Steps

- Refine exclusion logic so relevant internships and early-career roles are less likely to be dropped
- Improve ranking or prioritization within the broader CIS-oriented role set
- Consider lightweight scoring for internship / entry-level / preferred-role emphasis
- Expand source coverage carefully without breaking sequential execution
- Keep schema and classifier logic shared rather than duplicating rules across scripts

---

## 12. Session Start Checklist

1. Read `MEMORY.md`
2. Read every file you plan to touch
3. Preserve CommonJS and sequential scraping
4. Keep metadata logic centralized when possible
5. Do not refactor unrelated systems during focused passes
