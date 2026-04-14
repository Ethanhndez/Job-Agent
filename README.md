# job-agent

An agent-based job search automation system that scrapes listings from multiple sources, filters them with a three-tier keyword system, writes structured records to a Notion workspace, and can auto-apply to matching roles — all orchestrated by Claude via the Anthropic API.

---

## Automated Workflow

| Step | What happens |
|------|--------------|
| **1. Scrape** | Playwright scrapers pull listings from Wellfound, Greenhouse, Lever, Ashby, Built In Austin/Houston, and YC Jobs |
| **2. Filter** | Three-tier filter removes irrelevant titles, missing keywords, and disqualifying phrases |
| **3. Organize** | Surviving listings are written to a Notion database and an Excel tracker |
| **4. Review** | You inspect the Notion board and mark roles you want to pursue |
| **5. Apply** | `apply.js` uses Claude to tailor your resume + generate a cover letter, then submits via Playwright |
| **6. Track** | Application status, dates, and notes are updated in both Notion and the Excel sheet |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js >= 18 |
| AI / LLM | Anthropic Claude (`@anthropic-ai/sdk`) |
| Browser automation | Playwright |
| Workspace | Notion (`@notionhq/client`) |
| Excel tracking | ExcelJS |
| Resume parsing | pdf-parse, mammoth (DOCX) |
| Document generation | docx |
| Config | dotenv |

---

## Job Sources

- **Wellfound** — startup-focused roles
- **Greenhouse** — ATS used by many mid-to-large tech companies
- **Lever** — ATS popular with growth-stage startups
- **Ashby** — modern ATS used by AI-native companies
- **Built In Austin** — Austin tech scene
- **Built In Houston** — Houston tech scene
- **YC Jobs** — Y Combinator portfolio companies

---

## Setup

```bash
# 1. Clone the repo
git clone https://github.com/<your-handle>/job-agent.git
cd job-agent

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Open .env and fill in ANTHROPIC_API_KEY, NOTION_TOKEN, NOTION_PARENT_PAGE_ID

# 4. Configure personal settings
cp config/user.config.example.js config/user.config.js
# Open config/user.config.js and fill in your details, job titles, and keywords

# 5. Add your resume
# Copy your resume PDF or DOCX into /resume/ and update config.resume.filename

# 6. Run first-time setup (creates Notion database schema)
npm run setup
```

---

## Usage

### Automated weekly scrape (GitHub Actions)

Push this repo to GitHub, then add three repository secrets:

| Secret | Value |
|--------|-------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `NOTION_TOKEN` | Your Notion integration token |
| `NOTION_PARENT_PAGE_ID` | Your Notion parent page ID |

The workflow in `.github/workflows/weekly-scrape.yml` runs every Monday at 8 AM UTC and opens a PR summarising new listings.

### Manual scrape

```bash
npm start
```

Runs all scrapers, filters results, and populates Notion + Excel.

### Apply to a role

```bash
npm run apply
```

Interactive prompt: paste a Notion page URL or job URL, review the tailored resume diff and cover letter, then confirm to auto-submit.

---

## Filtering System

Listings pass through three sequential gates before being written to Notion.

```js
// Tier 1 — title must match at least one entry in config.jobTitles
const titleMatch = config.jobTitles.some(t =>
  listing.title.toLowerCase().includes(t.toLowerCase())
);

// Tier 2 — description must contain at least one keyword from config.keywords
const keywordMatch = config.keywords.some(k =>
  listing.description.toLowerCase().includes(k.toLowerCase())
);

// Tier 3 — description must NOT contain any disqualifying phrase
const notExcluded = !config.excludeKeywords.some(k =>
  listing.description.toLowerCase().includes(k.toLowerCase())
);

const passes = titleMatch && keywordMatch && notExcluded;
```

Tune `config/user.config.js` to widen or narrow each tier independently.

---

## Resume Tailoring Guardrail

The application agent asks Claude to identify the **top 3–5 bullet points** from your base resume that best match the job description and reorder/lightly reword them for relevance. It will **never invent experience you do not have** — the prompt explicitly constrains it to content already present in your resume. A diff is shown for your approval before any file is written or submitted.

---

## Notion Workspace Structure

```
📁 Job Search (parent page you configure)
└── 🗃️ Job Listings (database created by setup.js)
    ├── Title
    ├── Company
    ├── Location
    ├── Source
    ├── URL
    ├── Date Found
    ├── Status          (New / Reviewing / Applied / Interviewing / Rejected / Offer)
    ├── Fit Score       (1–10, set by Claude filter agent)
    ├── Notes
    └── Applied Date
```

---

## Excel Tracker Columns

| Column | Description |
|--------|-------------|
| Job Title | Role name |
| Company | Employer |
| Location | City / Remote |
| Source | Which scraper found it |
| URL | Direct link to listing |
| Date Found | ISO date scraped |
| Status | Application stage |
| Fit Score | 1–10 relevance score |
| Applied Date | Date submitted |
| Follow-up Date | Calculated +7 days from applied |
| Notes | Free-text field |

---

## Roadmap

| Version | Milestone |
|---------|-----------|
| **v1.0** | Scrapers, three-tier filter, Notion writer, Excel tracker, GitHub Actions weekly run |
| **v1.1** | `apply.js` auto-application flow with resume tailoring and cover letter generation |
| **v2.0** | Interview prep agent, follow-up email drafter, multi-resume profile support |
