'use strict';

/**
 * scrapers/greenhouse.js
 *
 * Scrapes Greenhouse-hosted job boards for AI/ML roles by querying the public
 * Greenhouse JSON API for a curated list of known AI/ML companies.
 *
 * Exported function:
 *   scrapeGreenhouse(browser, config)
 *     @param {import('playwright').Browser} browser - Launched Playwright browser
 *     @param {object} config  - User config from config/user.config.js
 *     @returns {Promise<Array>} Array of raw job objects
 */

// Curated list of AI/ML companies known to use Greenhouse job boards.
// Token is the subdomain used in https://boards.greenhouse.io/{token}
const GREENHOUSE_COMPANIES = [
  { name: 'Anthropic',       token: 'anthropic'        },
  { name: 'Scale AI',        token: 'scaleai'          },
  { name: 'Waymo',           token: 'waymo'            },
  { name: 'Databricks',      token: 'databricks'       },
  { name: 'Cohere',          token: 'cohere'           },
  { name: 'Character.AI',    token: 'character'        },
  { name: 'ElevenLabs',      token: 'elevenlabs'       },
  { name: 'Runway',          token: 'runwayml'         },
  { name: 'Aurora',          token: 'aurora'           },
  { name: 'Recursion',       token: 'recursionpharma'  },
  { name: 'Nauto',           token: 'nauto'            },
  { name: 'Insitro',         token: 'insitro'          },
  { name: 'Imbue',           token: 'imbue'            },
  { name: 'Cognition',       token: 'cognition'        },
  { name: 'Harvey AI',       token: 'harvey'           },
];

// Keywords used for a fast title-based pre-filter before returning raw jobs.
const ML_TITLE_KEYWORDS = [
  'machine learning', 'ml ', 'ai ', 'artificial intelligence',
  'deep learning', 'nlp', 'llm', 'data science', 'computer vision',
  'research engineer', 'applied scientist',
];

/**
 * Returns true when the job title looks like an AI/ML role.
 * This is a broad pre-filter to avoid returning every engineering job from
 * each board; the full filter tiers run later in the orchestrator.
 *
 * @param {string} title
 * @returns {boolean}
 */
function looksLikeMlRole(title) {
  const lower = title.toLowerCase();
  return ML_TITLE_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Fetches jobs from one Greenhouse board via its public JSON API.
 *
 * @param {string} token    - Greenhouse board token
 * @param {string} company  - Human-readable company name (for fallback)
 * @param {string} today    - ISO date string
 * @returns {Promise<Array>} Raw job objects for ML-adjacent roles
 */
async function fetchGreenhouseBoard(token, company, today) {
  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`;

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

  const jobs = data.jobs || [];

  return jobs
    .filter(j => looksLikeMlRole(j.title || ''))
    .map(j => {
      // Greenhouse returns HTML in j.content — strip tags for description.
      const description = (j.content || '')
        .replaceAll(/<[^>]+>/g, ' ')
        .replaceAll(/\s+/g, ' ')
        .trim();

      const location = j.location?.name || '';

      return {
        title:       j.title       || '',
        company:     j.company     ? j.company.name : company,
        location,
        salary:      '',
        sourceUrl:   j.absolute_url || `https://boards.greenhouse.io/${token}/jobs/${j.id}`,
        dateFound:   today,
        description,
      };
    });
}

/**
 * Scrapes Greenhouse-hosted boards for AI/ML roles and returns raw job objects.
 *
 * Iterates through GREENHOUSE_COMPANIES, calls the public Greenhouse JSON API
 * for each, pre-filters by title, and stops once maxJobsPerSource is reached.
 * The browser instance is accepted for interface consistency but is not used —
 * the Greenhouse API is public JSON and does not require a rendered browser.
 *
 * @param {import('playwright').Browser} _browser
 * @param {object} config
 * @returns {Promise<Array<{title,company,location,salary,sourceUrl,dateFound,description}>>}
 */
async function scrapeGreenhouse(_browser, config) {
  const max   = config.scraper.maxJobsPerSource;
  const today = new Date().toISOString().split('T')[0];
  const seen  = new Set();
  const jobs  = [];

  for (const { name, token } of GREENHOUSE_COMPANIES) {
    if (jobs.length >= max) break;

    console.log(`  [greenhouse] fetching board: ${name} (${token})`);

    try {
      const board = await fetchGreenhouseBoard(token, name, today);

      for (const job of board) {
        if (jobs.length >= max) break;
        if (!job.sourceUrl || seen.has(job.sourceUrl)) continue;

        seen.add(job.sourceUrl);
        jobs.push(job);
      }

      console.log(`  [greenhouse] ${jobs.length} jobs collected so far`);

      // Be polite between board requests.
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`  [greenhouse] error on board "${name}":`, err.message);
    }
  }

  return jobs;
}

module.exports = { scrapeGreenhouse };
