# job-agent — Session Memory

Read this file at the start of every session. Then read the files relevant to your current task before writing any code. Never modify code you haven't read in full.

---

## 1. Project Overview

job-agent is a Node.js automation system for an AI/ML job search. It:

1. Scrapes job listings from 7 sources on a weekly schedule
2. Filters them through a 4-tier keyword/location gate
3. Writes surviving listings to a Notion database (deduped by URL + SHA-256 fingerprint)
4. Lets the user mark roles "Apply" in Notion
5. Uses Claude to tailor the resume and generate a cover letter per role
6. Logs every submitted application to Notion and an Excel file

Target user: mid-level AI/ML engineer, Austin/Houston/Remote, no PhD, no clearance.

---

## 2. Tech Stack

| Package | Version | Why it's here |
|---|---|---|
| `@anthropic-ai/sdk` | ^0.36.0 | Claude API — resume tailoring, cover letter generation |
| `@notionhq/client` | ^2.2.15 | Reads/writes Job Listings DB and Applications DB |
| `playwright` | ^1.44.0 | Headless Chromium for sites that need a real browser (Wellfound, BuiltIn, YC Jobs) |
| `pdf-parse` | ^1.1.1 | Ingests PDF resumes as plain text |
| `mammoth` | ^1.8.0 | Ingests DOCX resumes as plain text |
| `docx` | ^8.5.0 | Generates tailored resume output as .docx |
| `exceljs` | ^4.4.0 | Writes and updates applications.xlsx tracker |
| `dotenv` | ^16.4.5 | Loads .env credentials at runtime |

Runtime: Node.js >= 18 (uses native `fetch`, `AbortSignal.timeout`, `node:crypto`, `node:fs`).

---

## 3. Locked Architecture Decisions

These are not up for debate. Do not deviate from them.

- **CommonJS only.** Every file uses `'use strict'`, `require()`, and `module.exports`. No `import`/`export` anywhere.
- **`async/await` throughout.** No raw Promise chains (`.then/.catch`) except for short inline timeouts (`new Promise(r => setTimeout(r, N))`).
- **No parallel scraping.** Scrapers run sequentially in `agents/scraper.js` to avoid rate-limiting and detection. Do not add `Promise.all` across scrapers.
- **Scrapers are pure data sources.** No filtering, deduplication, or Notion writes inside any scraper file. Every scraper returns a raw array and nothing else.
- **Notion client is caller-owned.** `agents/notionWriter.js` never reads env vars or constructs a `Client`. The caller passes in the authenticated client.
- **Config is always passed down, never re-required inside modules.** `userConfig` is required once in `agents/scraper.js` and `apply.js` and then passed as a parameter.
- **No invented experience.** The Claude prompt for resume tailoring must explicitly prohibit fabricating skills, tools, or responsibilities not present in the source resume.

---

## 4. Folder Structure

```
job-agent/
│
├── .env                         # Local secrets — gitignored, never commit
├── .env.example                 # Template showing required env var names
├── .gitignore
├── package.json                 # CommonJS, Node >= 18, npm scripts: setup / start / apply
├── README.md                    # Public-facing docs
├── MEMORY.md                    # This file — session orientation for Claude Code
│
├── index.js                     # [STUB] npm start entry point — calls runScraper()
├── apply.js                     # [STUB] npm run apply entry point — full application loop
│
├── setup.js                     # First-run wizard: creates Notion root page + both DBs,
│                                #   writes IDs to config/notion.config.json.
│                                #   Exports buildRootPageBlocks() for scripts/updateNotionPage.js
│
├── agents/
│   ├── scraper.js               # Orchestrator: launches Playwright, runs all scrapers in
│   │                            #   sequence, fingerprint → filter → dedupe → Notion write
│   ├── notionWriter.js          # All Notion reads/writes: loadNotionConfig, jobExistsByUrl,
│   │                            #   jobExistsByFingerprint, createJobPage, updateJobStatus,
│   │                            #   getJobsWithStatus, createApplicationEntry
│   ├── applicationAgent.js      # [STUB] Claude-powered resume tailoring + cover letter gen
│   └── tracker.js               # [STUB] Writes application record to Notion + Excel
│
├── scrapers/
│   ├── wellfound.js             # Playwright — wellfound.com/jobs search (requires login, inactive)
│   ├── greenhouse.js            # Node fetch — Greenhouse public JSON API, 15 AI/ML companies
│   ├── lever.js                 # Node fetch — Lever public v0 API, 14 AI/ML companies
│   ├── ashby.js                 # Node fetch — Ashby posting API, 14 AI/ML companies
│   ├── builtinAustin.js         # Playwright — builtin.com/jobs/austin ML+AI category pages
│   ├── builtinHouston.js        # Playwright — builtin.com/jobs/texas ML+AI category pages
│   └── ycJobs.js                # Playwright — workatastartup.com, pagination + infinite scroll
│
├── utils/
│   ├── dedupe.js                # generateFingerprint(company, title, location) → SHA-256 hex
│   │                            #   applyFilters(job, config) → { pass, failedTier }
│   ├── resumeParser.js          # [STUB] PDF/DOCX ingestion → plain text string
│   └── claudeClient.js          # [STUB] Anthropic SDK wrapper — askClaude(system, user, opts)
│
├── templates/
│   └── coverLetter.js           # [STUB] Formats Claude's cover letter output into .docx
│
├── config/
│   ├── user.config.example.js   # Shape reference for user.config.js — committed to repo
│   ├── user.config.js           # Personal config — gitignored, never commit
│   └── notion.config.json       # Written by setup.js — contains DB IDs — gitignored
│
├── resume/                      # Drop your PDF or DOCX here — gitignored
│
├── scripts/
│   └── updateNotionPage.js      # One-time script: re-appends content blocks to root page
│                                #   without touching DBs. Imports buildRootPageBlocks from setup.js
│
└── .github/
    └── workflows/
        └── weekly-scrape.yml    # [STUB] GitHub Actions — runs every Sunday 8am UTC
```

---

## 5. Build Order

### Phase 1 — Foundation — COMPLETE
`package.json`, `.env.example`, `.gitignore`, `config/user.config.example.js`, all stub files created.

### Phase 2 — Notion Infrastructure — COMPLETE
- `setup.js` — first-run wizard, creates workspace, writes `config/notion.config.json`
- `agents/notionWriter.js` — all Notion reads/writes
- `scripts/updateNotionPage.js` — re-applies root page design blocks

### Phase 3 — Scraping Pipeline — COMPLETE (tested against live Notion)
- `utils/dedupe.js` — fingerprinting + 4-tier filter
- `agents/scraper.js` — orchestrator
- `scrapers/greenhouse.js` — public JSON API, working
- `scrapers/lever.js` — public JSON API, working (boards may have sparse postings)
- `scrapers/ashby.js` — public JSON API, working (boards may have sparse postings)
- `scrapers/builtinAustin.js` — Playwright, working
- `scrapers/builtinHouston.js` — Playwright, working
- `scrapers/ycJobs.js` — Playwright, working
- `scrapers/wellfound.js` — Playwright, implemented but inactive (requires login)

### Phase 4 — Resume Ingestion & Claude Client — REMAINING
Build these first. Everything in Phase 5 depends on them.

1. `utils/resumeParser.js` — reads `config.resume.filename` from `/resume/` dir, uses `pdf-parse` for .pdf and `mammoth` for .docx/.doc, returns plain text string
2. `utils/claudeClient.js` — initializes `Anthropic` client from `ANTHROPIC_API_KEY`, exposes `askClaude(systemPrompt, userPrompt, options)`, uses prompt caching on system prompt (resume text will be passed there repeatedly)

### Phase 5 — Application Pipeline — REMAINING
Build in this exact order. Each file depends on the one before it.

3. `agents/applicationAgent.js` — takes parsed resume + Notion job page, calls Claude to select and lightly reword 3–5 most relevant bullets, generate cover letter, show diff, require explicit confirmation before returning
4. `templates/coverLetter.js` — formats Claude's cover letter string into a structured .docx document using the `docx` package
5. `agents/tracker.js` — after a confirmed application, calls `createApplicationEntry()` from notionWriter.js and appends a row to `applications.xlsx` via ExcelJS
6. `apply.js` — top-level apply loop: calls `getJobsWithStatus(notionClient, dbId, 'Apply')`, iterates jobs, runs applicationAgent, on confirm calls tracker + `updateJobStatus` to flip status to `Applied`

### Phase 6 — Entry Points & Automation — REMAINING
7. `index.js` — `npm start` entry point, calls `runScraper()`, optionally surfaces any "Apply"-status jobs at the end
8. `.github/workflows/weekly-scrape.yml` — GitHub Actions cron running `npm start` every Sunday 8am UTC, using secrets `ANTHROPIC_API_KEY`, `NOTION_TOKEN`, `NOTION_PARENT_PAGE_ID`

---

## 6. Current Status

### Working (tested against live Notion, last run: 248 found, 9 passed, 1 written, 8 duplicates)
- Greenhouse API scraper — actively producing results (Anthropic board is the main source)
- BuiltIn Austin Playwright scraper — working
- BuiltIn Houston Playwright scraper — working
- YC Jobs Playwright scraper — working
- Lever API scraper — refreshed with 15 verified working tokens (2026-04-13)
- Ashby API scraper — fixed API bug (response key changed to `jobs`); compensation structure updated; 15 verified tokens
- Full pipeline: fingerprint → 4-tier filter → URL dedupe → fingerprint dedupe → Notion write

### Scrapers — Important Notes
- **Ashby API changed**: response key is now `jobs` (not `jobPostings`). Compensation uses `summaryComponents` array. Both fixed in `scrapers/ashby.js`.
- **Lever tokens**: many older tokens (togetherai, wandb, stability-ai, huggingface, mistral-ai, poolside, etc.) now return 404. Working tokens: mistral, palantir, spotify, zoox, hive, levelai, sonarsource, ciandt, tri, field-ai, fullscript, imo-online, aeratechnology, weride, anyscale.
- **Ashby tokens**: working tokens: openai, harvey, sierra, cohere, cursor, perplexity, synthesia, cognition, writer, replit, lambda, modal, character, llamaindex, pika.
- **Wellfound** — gracefully disabled. No public API or RSS feed exists without authentication. Logs a warning and returns `[]`.
- **GitHub Actions workflow** — still a stub (`# TODO: implement in phase build`).

### Gitignored files that must exist locally to run
- `.env` — `ANTHROPIC_API_KEY`, `NOTION_TOKEN`, `NOTION_PARENT_PAGE_ID`
- `config/user.config.js` — personal job titles, keywords, locations, resume filename
- `config/notion.config.json` — written by `setup.js`, contains the three DB IDs
- `resume/` — directory containing the user's resume PDF or DOCX

---

## 7. Notion Workspace

### IDs (from config/notion.config.json)
```json
{
  "rootPageId":       "342d7b89-5c0b-8154-a2ed-e51f1457d518",
  "jobListingsDbId":  "342d7b89-5c0b-812a-acff-cfb5da313ea5",
  "applicationsDbId": "342d7b89-5c0b-818a-8c18-e417f1301a62"
}
```

### Job Listings DB fields (jobListingsDbId)
| Field | Notion type | Notes |
|---|---|---|
| Title | title | Job title — serves as page name |
| Company | rich_text | |
| Location | rich_text | |
| Salary | rich_text | Empty string when unavailable |
| Source URL | url | Direct link to listing |
| Date Found | date | ISO 8601, set at scrape time |
| Status | select | See progression below |
| Applied Date | date | Set by apply.js |
| Resume Version | rich_text | Filename of tailored resume, e.g. `resume-acme-v2.docx` |
| Cover Letter | checkbox | true when a cover letter was generated |
| Fingerprint | rich_text | SHA-256 hex of `company|title|location` — used for dedup |

### Applications DB fields (applicationsDbId)
| Field | Notion type | Notes |
|---|---|---|
| Company | title | Primary key — serves as page name |
| Role | rich_text | Job title |
| Location | rich_text | |
| Date Applied | date | ISO 8601 |
| Resume Version | rich_text | Tailored resume filename |
| Cover Letter | checkbox | |
| Status | rich_text | e.g. "Submitted", "Pending" |
| Notion URL | url | Link back to the Job Listings page |

### Status Progression
```
New → Reviewing → Apply → Applied → Interviewing → Rejected → Offer
```
The agent reads pages with status `Apply`. It flips them to `Applied` after a confirmed submission. All other transitions are manual.

---

## 8. Filter System

Implemented in `utils/dedupe.js` → `applyFilters(job, config)`.

Returns `{ pass: boolean, failedTier: 1|2|3|4|null }`.

Tiers run in order. First failure exits immediately.

### Tier 1 — Title match (always enforced)
`job.title` must case-insensitively contain at least one string from `config.jobTitles`.
Jobs failing here are logged as `✗ filtered [tier 1]`.

### Tier 2 — Keyword match (skipped when no description)
`job.description` must contain at least one string from `config.keywords`.
Skipped entirely when `job.description` is empty or absent — scrapers that can't capture a description inline (Wellfound, BuiltIn, YC Jobs) should not be silently penalized.

### Tier 3 — Exclude keyword (skipped when no description)
`job.description` must NOT contain any string from `config.excludeKeywords`.
Same skip-when-absent logic as Tier 2.

### Tier 4 — Location match (skipped when `preferredLocations` is `[]`)
`job.location` must case-insensitively contain at least one string from `config.preferredLocations`.
Exception: any location containing the substring `"remote"` automatically passes regardless of the preferred list.
Disable entirely by setting `preferredLocations: []` in user config.

### Current filter config (config/user.config.js)
- **jobTitles (15):** AI Engineer, ML Engineer, Machine Learning Engineer, AI/ML Engineer, Applied AI Engineer, LLM Engineer, NLP Engineer, Generative AI Engineer, Research Engineer, Founding AI Engineer, Founding Full Stack AI Engineer, AI Research Engineer, AI Platform Engineer, AI Infrastructure Engineer, AI Software Engineer
- **keywords (20):** LLM, large language model, GPT, Claude, transformer, fine-tuning, RAG, retrieval-augmented, vector database, embeddings, PyTorch, TensorFlow, Hugging Face, diffusion model, multimodal, prompt engineering, agent, agentic, langchain, openai, anthropic
- **excludeKeywords (11):** "10+ years", "10 years experience", "PhD required", "PhD preferred", "requires PhD", "security clearance required", "must be US citizen", "staff engineer", "principal engineer", "director of", "VP of", "vice president"
- **preferredLocations (5):** "Remote", "Austin", "Houston", "Texas", " TX"

---

## 9. Resume Tailoring Guardrail

This is a hard constraint on what `agents/applicationAgent.js` may ask Claude to do.

**Allowed:**
- Select the 3–5 bullet points from the base resume that best match the job description
- Reorder those bullets to lead with the most relevant
- Lightly rephrase for concision or keyword alignment

**Prohibited:**
- Inventing skills, tools, technologies, or responsibilities not present in the source resume
- Fabricating years of experience, project names, company names, or metrics
- Adding new bullet points that have no basis in the source resume

The Claude system prompt must state these constraints explicitly. A diff of changes must be shown to the user before any file is written or any application is submitted. The user must type a confirmation to proceed.

---

## 10. v1.0 Scope Boundary

### In scope for v1.0 (this repo, Phases 1–6)
- Scraping (7 sources), filtering (4 tiers), Notion write with dedup
- Resume ingestion (PDF + DOCX)
- Claude-powered resume tailoring (select + reorder, no fabrication)
- Cover letter generation
- Application tracking (Notion Applications DB + applications.xlsx)
- Weekly GitHub Actions automation
- Interactive `apply.js` confirmation flow

### Deferred to v1.1
- Auto-submission via Playwright (filling and submitting application forms)
- Multi-resume profile support (different base resumes for different role types)

### Deferred to v2.0
- Interview prep agent
- Follow-up email drafter
- Recruiter outreach tracking

---

## 11. How to Start a New Session

1. Read this file (`MEMORY.md`) first.
2. Identify which phase you're working on from Section 5.
3. Read every file relevant to your task before writing or proposing any code.
4. If modifying an existing file, read it in full — do not skim.
5. If adding a new file, read the files it will import from or be called by first.
6. Respect the architecture decisions in Section 3 — CommonJS, sequential scrapers, no fabrication.
7. Run `node -e "require('dotenv').config(); const { runScraper } = require('./agents/scraper'); runScraper();"` to test the scraping pipeline end-to-end.
