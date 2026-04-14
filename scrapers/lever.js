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
// Verified against the live Lever v0 API — all tokens return HTTP 200 as of 2026-04-13.
const LEVER_COMPANIES = [
  { name: 'Mistral AI',           token: 'mistral'        }, // 145 postings
  { name: 'Palantir',             token: 'palantir'       }, // 244 postings — AI/data platform
  { name: 'Spotify',              token: 'spotify'        }, // 177 postings, ~20 ML/AI
  { name: 'Zoox',                 token: 'zoox'           }, // 213 postings, ~40 ML/AI (AV)
  { name: 'Hive AI',              token: 'hive'           }, // 74 postings, ~8 ML/AI
  { name: 'Level AI',             token: 'levelai'        }, // 27 postings, ~6 ML/AI
  { name: 'SonarSource',          token: 'sonarsource'    }, // 109 postings, ~8 ML/AI
  { name: 'CI&T',                 token: 'ciandt'         }, // 196 postings, ~7 ML/AI (AI consulting)
  { name: 'Toyota Research Inst', token: 'tri'            }, // 16 postings (AV/robotics AI research)
  { name: 'Field AI',             token: 'field-ai'       }, // 69 postings (autonomous robotics)
  { name: 'Fullscript',           token: 'fullscript'     }, // 28 postings, ~3 ML/AI
  { name: 'IMO Health',           token: 'imo-online'     }, // 10 postings, ~3 ML/AI (clinical AI)
  { name: 'Aera Technology',      token: 'aeratechnology' }, // 28 postings (agentic AI/LLM)
  { name: 'WeRide',               token: 'weride'         }, // 32 postings (autonomous driving AI)
  { name: 'Anyscale',             token: 'anyscale'       }, // Ray distributed computing / LLM infra
];

const ML_TITLE_KEYWORDS = [
  'machine learning', 'ml ', ' ai ', 'artificial intelligence',
  'deep learning', 'nlp', 'llm', 'data science', 'computer vision',
  'research engineer', 'applied scientist', 'research scientist', 'intern', 'co-op', 'coop',
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
 * @returns {Promise<Array>}
 */
async function fetchLeverBoard(token, company) {
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

      // Format salary as "$XXX,XXX - $XXX,XXX"; fall back to "Not listed".
      let salary = 'Not listed';
      if (p.salaryRange) {
        const { min, max, currency } = p.salaryRange;
        const sym = (!currency || currency.toUpperCase() === 'USD') ? '$' : `${currency} `;
        const fmt = n => Number(n).toLocaleString('en-US');
        if (min && max) salary = `${sym}${fmt(min)} - ${sym}${fmt(max)}`;
        else if (min)   salary = `${sym}${fmt(min)}+`;
        else if (max)   salary = `up to ${sym}${fmt(max)}`;
      }

      return {
        title:       p.text        || 'Not listed',
        company,
        location,
        salary,
        sourceUrl:   p.hostedUrl   || `https://jobs.lever.co/${token}/${p.id}`,
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
 * @returns {Promise<Array<{title,company,location,salary,sourceUrl,description}>>}
 */
async function scrapeLever(_browser, config) {
  const max   = config.scraper.maxJobsPerSource;
  const seen  = new Set();
  const jobs  = [];

  for (const { name, token } of LEVER_COMPANIES) {
    if (jobs.length >= max) break;

    console.log(`  [lever] fetching board: ${name} (${token})`);

    try {
      const board = await fetchLeverBoard(token, name);

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
