'use strict';

/**
 * scrapers/ashby.js
 *
 * Scrapes Ashby-hosted job boards for AI/ML roles via the public Ashby
 * posting API.
 *
 * Exported function:
 *   scrapeAshby(browser, config)
 *     @param {import('playwright').Browser} browser - Launched Playwright browser
 *     @param {object} config  - User config from config/user.config.js
 *     @returns {Promise<Array>} Array of raw job objects
 */

// Curated list of AI/ML companies known to use Ashby.
// Verified against the live Ashby posting API — all tokens return HTTP 200 as of 2026-04-13.
const ASHBY_COMPANIES = [
  { name: 'OpenAI',          token: 'openai'          }, // 638 postings, ~68 ML/AI
  { name: 'Harvey AI',       token: 'harvey'          }, // 232 postings, ~9 ML/AI (legal AI)
  { name: 'Sierra AI',       token: 'sierra'          }, // 139 postings (conversational AI)
  { name: 'Cohere',          token: 'cohere'          }, // 119 postings, ~13 ML/AI
  { name: 'Cursor',          token: 'cursor'          }, // 78 postings, ~4 ML/AI (AI code editor)
  { name: 'Perplexity AI',   token: 'perplexity'      }, // 76 postings, ~11 ML/AI
  { name: 'Synthesia',       token: 'synthesia'       }, // 68 postings, ~7 ML/AI (video AI)
  { name: 'Cognition',       token: 'cognition'       }, // 59 postings, ~2 ML/AI (Devin/SWE agent)
  { name: 'Writer',          token: 'writer'          }, // 46 postings, ~19 ML/AI (enterprise LLM)
  { name: 'Replit',          token: 'replit'          }, // 86 postings, ~3 ML/AI
  { name: 'Lambda',          token: 'lambda'          }, // 30 postings (GPU cloud / LLM infra)
  { name: 'Modal',           token: 'modal'           }, // 25 postings (serverless ML infra)
  { name: 'Character AI',    token: 'character'       }, // 16 postings, ~8 ML/AI
  { name: 'LlamaIndex',      token: 'llamaindex'      }, // 12 postings, ~3 ML/AI (RAG framework)
  { name: 'Pika Labs',       token: 'pika'            }, // video generation AI
];

const ML_TITLE_KEYWORDS = [
  'machine learning', 'ml ', ' ai ', 'artificial intelligence',
  'deep learning', 'nlp', 'llm', 'data science', 'computer vision',
  'research engineer', 'applied scientist', 'research scientist',
];

/**
 * Returns true when the job title looks like an AI/ML role.
 *
 * @param {string} title
 * @returns {boolean}
 */
function looksLikeMlRole(title) {
  const lower = title.toLowerCase();
  return ML_TITLE_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Formats an Ashby compensation object as "$XXX,XXX - $XXX,XXX".
 * Returns "Not listed" when no usable data is present.
 *
 * @param {object|undefined} compensation - p.compensation from the Ashby API
 * @returns {string}
 */
function formatAshbySalary(compensation) {
  if (!compensation) return 'Not listed';

  const comp = compensation;
  const sc   = Array.isArray(comp.summaryComponents) && comp.summaryComponents[0];
  const cur  = (sc?.currencyCode || comp.currency || comp.currencyCode || 'USD').toUpperCase();
  const sym  = cur === 'USD' ? '$' : `${cur} `;
  const fmt  = n => Number(n).toLocaleString('en-US');
  const minV = sc ? sc.minValue : comp.minValue;
  const maxV = sc ? sc.maxValue : comp.maxValue;

  if (minV && maxV) return `${sym}${fmt(minV)} - ${sym}${fmt(maxV)}`;

  if (comp.compensationTierSummary) {
    const m = /(\$[\d,]+(?:K)?)\s*[-–]\s*(\$[\d,]+(?:K)?)/.exec(comp.compensationTierSummary);
    if (m) return `${m[1]} - ${m[2]}`;
  }

  return 'Not listed';
}

/**
 * Fetches job postings from one Ashby board via the public posting API.
 *
 * @param {string} token    - Ashby company token (subdomain in jobs.ashbyhq.com/{token})
 * @param {string} company  - Human-readable company name
 * @param {string} today    - ISO date string
 * @returns {Promise<Array>}
 */
async function fetchAshbyBoard(token, company, today) {
  const apiUrl =
    `https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`;

  let data;
  try {
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; job-agent/1.0)' },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return [];
    data = await res.json();
  } catch {
    return [];
  }

  // API returns { jobs: [...], apiVersion: "..." } as of 2026.
  // Earlier versions used { jobPostings: [...] } — keep fallback for safety.
  const postings = data.jobs || data.jobPostings || [];

  return postings
    .filter(p => looksLikeMlRole(p.title || ''))
    .map(p => {
      const description = (p.descriptionPlain || p.description || '')
        .replaceAll(/<[^>]+>/g, ' ')
        .trim();

      const loc = p.location || p.locationName || '';

      const salary = formatAshbySalary(p.compensation);

      // Use the posting's published timestamp when available.
      const datePosted = p.publishedAt
        ? new Date(p.publishedAt).toISOString().split('T')[0]
        : today;

      return {
        title:     p.title    || 'Not listed',
        company,
        location:  loc,
        salary,
        sourceUrl: p.jobUrl || `https://jobs.ashbyhq.com/${token}/${p.id}`,
        datePosted,
        description,
      };
    });
}

/**
 * Scrapes Ashby-hosted boards for AI/ML roles and returns raw job objects.
 *
 * Iterates through ASHBY_COMPANIES, calls the public Ashby posting API for
 * each, pre-filters by title, and stops once maxJobsPerSource is reached.
 * The browser instance is accepted for interface consistency but is not used.
 *
 * @param {import('playwright').Browser} _browser
 * @param {object} config
 * @returns {Promise<Array<{title,company,location,salary,sourceUrl,datePosted,description}>>}
 */
async function scrapeAshby(_browser, config) {
  const max   = config.scraper.maxJobsPerSource;
  const today = new Date().toISOString().split('T')[0];
  const seen  = new Set();
  const jobs  = [];

  for (const { name, token } of ASHBY_COMPANIES) {
    if (jobs.length >= max) break;

    console.log(`  [ashby] fetching board: ${name} (${token})`);

    try {
      const board = await fetchAshbyBoard(token, name, today);

      for (const job of board) {
        if (jobs.length >= max) break;
        if (!job.sourceUrl || seen.has(job.sourceUrl)) continue;

        seen.add(job.sourceUrl);
        jobs.push(job);
      }

      console.log(`  [ashby] ${jobs.length} jobs collected so far`);
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`  [ashby] error on board "${name}":`, err.message);
    }
  }

  return jobs;
}

module.exports = { scrapeAshby };
