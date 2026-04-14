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
const ASHBY_COMPANIES = [
  { name: 'Perplexity AI',   token: 'perplexity-ai'  },
  { name: 'Groq',            token: 'groq'            },
  { name: 'Anyscale',        token: 'anyscale'        },
  { name: 'xAI',             token: 'xai'             },
  { name: 'Moonshot AI',     token: 'moonshot'        },
  { name: 'Contextual AI',   token: 'contextual'      },
  { name: 'Reka AI',         token: 'reka'            },
  { name: 'Sakana AI',       token: 'sakana-ai'       },
  { name: 'Nuro',            token: 'nuro'            },
  { name: 'Coreweave',       token: 'coreweave'       },
  { name: 'Lambda Labs',     token: 'lambdalabs'      },
  { name: 'Cohere',          token: 'cohere'          },
  { name: 'Glean',           token: 'glean-2'         },
  { name: 'Vanta',           token: 'vanta'           },
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

  const postings = data.jobPostings || [];

  return postings
    .filter(p => looksLikeMlRole(p.title || ''))
    .map(p => {
      const description = (p.descriptionPlain || p.description || '')
        .replaceAll(/<[^>]+>/g, ' ')
        .trim();

      const loc = p.location || p.locationName || '';

      let salary = '';
      if (p.compensation) {
        const { minValue, maxValue, currency } = p.compensation;
        if (minValue || maxValue) {
          salary = `${currency || ''}${minValue || ''}–${maxValue || ''}`;
        }
      }

      return {
        title:     p.title    || '',
        company:   p.company?.name || company,
        location:  loc,
        salary,
        sourceUrl: p.jobUrl || `https://jobs.ashbyhq.com/${token}/${p.id}`,
        dateFound: today,
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
 * @returns {Promise<Array<{title,company,location,salary,sourceUrl,dateFound,description}>>}
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
