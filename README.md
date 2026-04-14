# Job-Agent

## Overview

Job-Agent is an agent-based technical job search automation system built in Node.js. It scrapes multiple job sources, filters for broader CIS-relevant technical roles, deduplicates listings, classifies them with normalized metadata, and syncs the results into a Notion database for review.

The project is designed for a practical workflow: collect roles, keep the dataset clean, and make the Notion board fast to scan and maintain.

## What it does

Job-Agent follows a simple sequential pipeline:

1. Scrape job listings from supported sources
2. Filter for relevant technical roles
3. Deduplicate by source URL and fingerprint
4. Classify each listing with normalized metadata
5. Sync results into Notion

The system currently emphasizes discovery and organization rather than ranking or application automation.

## Supported sources

- Greenhouse
- Lever
- Ashby
- BuiltIn Austin
- BuiltIn Houston
- YC Jobs
- Wellfound — skipped by design because authentication is required

All sources are executed sequentially. The scraper does not run sources in parallel.

## Metadata intelligence

Job-Agent writes normalized metadata into Notion for visual scanning and downstream organization.

### Employment Type

- `Internship`
- `Full-Time`
- `Unknown`

### Experience Level

- `Internship`
- `Entry Level`
- `Associate`
- `Mid Level`
- `Senior`
- `Staff+`
- `Unknown`

### Color-coded Notion tags

Employment Type colors:

- `Internship` → `purple`
- `Full-Time` → `green`
- `Unknown` → `gray`

Experience Level colors:

- `Internship` → `purple`
- `Entry Level` → `blue`
- `Associate` → `green`
- `Mid Level` → `yellow`
- `Senior` → `orange`
- `Staff+` → `red`
- `Unknown` → `gray`

### Historical metadata backfill

Older rows can be repaired with:

```bash
node scripts/backfillMetadata.js
```

The backfill script scans the existing Job Listings database, classifies rows with missing or invalid metadata, and only updates fields that actually need repair.

## Current target role categories

The project is no longer narrowly AI-only. It now targets broader CIS-oriented technical roles such as:

- software engineering
- software development
- full stack / backend / frontend
- data / analytics / BI
- cybersecurity / security engineering
- infrastructure / cloud / devops / SRE
- product engineering
- product design / UX / UI
- solutions / forward deployed / implementation
- AI / ML roles

This broader direction is implemented through the current title, keyword, exclusion, and location filters in the local config and shared filter utilities.

## Tech stack / architecture

Main runtime stack:

- Node.js
- Playwright
- Notion API
- Anthropic SDK
- CommonJS modules

High-level repo structure:

- `agents/` — scraper orchestration and Notion integration
- `utils/` — shared filtering, fingerprinting, and classification helpers
- `scripts/` — one-off maintenance and migration scripts
- `config/` — local user config and generated Notion config
- `setup.js` — creates the Notion workspace and database structure
- `index.js` — scraper entry point used by `npm start`

Key current files:

- `agents/scraper.js`
- `agents/notionWriter.js`
- `utils/dedupe.js`
- `utils/jobClassifier.js`
- `scripts/backfillMetadata.js`

## Setup

```bash
git clone https://github.com/<your-handle>/job-agent.git
cd job-agent
npm install
cp .env.example .env
cp config/user.config.example.js config/user.config.js
```

Then fill in:

- `.env`
  - `ANTHROPIC_API_KEY`
  - `NOTION_TOKEN`
  - `NOTION_PARENT_PAGE_ID`
- `config/user.config.js`
  - personal info
  - local filtering preferences
  - resume filename

After configuration, run the first-time Notion setup:

```bash
npm run setup
```

## Running the scraper

```bash
npm start
```

This runs the full sequential scrape, filter, dedupe, classify, and Notion sync pipeline.

## Backfilling historical metadata

```bash
node scripts/backfillMetadata.js
```

Use this after metadata or schema upgrades when you want to repair older Notion rows that are missing `Employment Type` or `Experience Level`.

## Notion integration

Job-Agent uses a Notion workspace created by `setup.js`.

The Job Listings database is used to:

- store surviving listings
- track review status
- store normalized metadata
- preserve a fingerprint for deduplication

The project also normalizes Notion select definitions and colors so the board stays visually consistent across fresh setups and existing databases.

## Current limitations

- Wellfound is skipped because authentication is required
- Duplicate-heavy runs may produce few or zero new writes even when the scraper is working correctly
- Historical metadata backfill quality depends on what information already exists in stored Notion rows
- Some filtering tradeoffs still exist, especially around blunt exclusion logic
- The current system is stronger at collection and organization than prioritization or ranking

## Roadmap

- refine filter precision without losing broad CIS coverage
- add lightweight priority scoring
- improve ranking for internships and entry-level roles
- expand source coverage carefully
- improve automation and scheduling

## Notes for contributors

- CommonJS only
- async/await only
- keep scraper execution sequential
- keep changes minimal and local
- avoid unrelated refactors during focused passes
- keep classifier, schema, and filter logic centralized when possible
