'use strict';

/**
 * scrapers/lever.js
 *
 * Scrapes Lever-hosted job boards for AI/ML roles via the public Lever v0 API.
 *
 * Exported function:
 *   scrapeLever(browser, config)
 *     @param {import('playwright').Browser} browser - Launched Playwright browser
 *     @param {object} config  - User config from config/user.config.js
 *     @returns {Promise<Array>} Array of raw job objects
 */

// Curated list of AI/ML companies known to use Lever.
const LEVER_COMPANIES = [
  { name: 'Together AI',     token: 'togetherai'     },
  { name: 'Modal Labs',      token: 'modal-labs'     },
  { name: 'Replicate',       token: 'replicate'      },
  { name: 'Weights & Biases',token: 'wandb'          },
  { name: 'Lightning AI',    token: 'lightning-ai'   },
  { name: 'Stability AI',    token: 'stability-ai'   },
  { name: 'Mistral AI',      token: 'mistral-ai'     },
  { name: 'Sierra',          token: 'sierra-ai'      },
  { name: 'Magic',           token: 'magic-ai'       },
  { name: 'Hugging Face',    token: 'huggingface'    },
  { name: 'Pika Labs',       token: 'pika-labs'      },
  { name: 'Luma AI',         token: 'luma-ai'        },
  { name: 'Poolside',        token: 'poolside'       },
  { name: 'Glean',           token: 'glean'          },
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
 * Fetches job postings from one Lever board via the public v0 JSON API.
 *
 * @param {string} token    - Lever company token (subdomain in jobs.lever.co/{token})
 * @param {string} company  - Human-readable company name
 * @param {string} today    - ISO date string
 * @returns {Promise<Array>}
 */
async function fetchLeverBoard(token, company, today) {
  const apiUrl = `https://api.lever.co/v0/postings/${token}?mode=json`;

  let postings;
  try {
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; job-agent/1.0)' },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return [];
    postings = await res.json();
  } catch {
    return [];
  }

  if (!Array.isArray(postings)) return [];

  return postings
    .filter(p => looksLikeMlRole(p.text || ''))
    .map(p => {
      const lists       = p.descriptionBody?.descriptionPlain || p.descriptionPlain || '';
      const description = (p.description || lists).replaceAll(/<[^>]+>/g, ' ').trim();
      const location    = p.categories?.location || p.workplaceType || '';
      const salary      = p.salaryRange
        ? `${p.salaryRange.currency || ''}${p.salaryRange.min || ''}–${p.salaryRange.max || ''}`
        : '';

      return {
        title:       p.text        || '',
        company,
        location,
        salary,
        sourceUrl:   p.hostedUrl   || `https://jobs.lever.co/${token}/${p.id}`,
        dateFound:   today,
        description,
      };
    });
}

/**
 * Scrapes Lever-hosted boards for AI/ML roles and returns raw job objects.
 *
 * Iterates through LEVER_COMPANIES, calls the public Lever API for each,
 * pre-filters by title, and stops once maxJobsPerSource is reached.
 * The browser instance is accepted for interface consistency but is not used.
 *
 * @param {import('playwright').Browser} _browser
 * @param {object} config
 * @returns {Promise<Array<{title,company,location,salary,sourceUrl,dateFound,description}>>}
 */
async function scrapeLever(_browser, config) {
  const max   = config.scraper.maxJobsPerSource;
  const today = new Date().toISOString().split('T')[0];
  const seen  = new Set();
  const jobs  = [];

  for (const { name, token } of LEVER_COMPANIES) {
    if (jobs.length >= max) break;

    console.log(`  [lever] fetching board: ${name} (${token})`);

    try {
      const board = await fetchLeverBoard(token, name, today);

      for (const job of board) {
        if (jobs.length >= max) break;
        if (!job.sourceUrl || seen.has(job.sourceUrl)) continue;

        seen.add(job.sourceUrl);
        jobs.push(job);
      }

      console.log(`  [lever] ${jobs.length} jobs collected so far`);
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`  [lever] error on board "${name}":`, err.message);
    }
  }

  return jobs;
}

module.exports = { scrapeLever };
