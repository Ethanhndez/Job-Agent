/**
 * user.config.example.js
 *
 * Copy this file to config/user.config.js and fill in your details.
 * config/user.config.js is gitignored — never commit your personal config.
 */

module.exports = {
  // ── Personal info ──────────────────────────────────────────────────────────
  // Used in cover letters, Notion pages, and application auto-fill.
  user: {
    name: "Your Full Name",
    email: "you@example.com",
    location: "Austin, TX",                // City, State shown on applications
    linkedIn: "https://linkedin.com/in/yourhandle",
    github: "https://github.com/yourhandle",
    portfolio: "https://yourportfolio.com", // Leave empty string "" if none
  },

  // ── Resume ─────────────────────────────────────────────────────────────────
  // Filename of your base resume, assumed to live in /resume/.
  // Supported formats: .pdf, .docx, .doc
  resume: {
    filename: "resume.pdf",
  },

  // ── Tier 1 filter — Job title matching ────────────────────────────────────
  // A job must match at least one of these titles (case-insensitive substring)
  // to pass the first filter stage. Be specific enough to avoid noise.
  jobTitles: [
    "AI Engineer",
    "ML Engineer",
    "Machine Learning Engineer",
    "Applied AI Engineer",
    "Applied ML Engineer",
    "LLM Engineer",
    "Generative AI Engineer",
    "AI/ML Engineer",
    "NLP Engineer",
  ],

  // ── Tier 2 filter — Keyword matching ──────────────────────────────────────
  // A job must mention at least one of these keywords in its description to
  // pass the second filter stage. Targets roles that use relevant tech.
  keywords: [
    "LLM",
    "large language model",
    "GPT",
    "Claude",
    "transformer",
    "fine-tuning",
    "RAG",
    "retrieval-augmented",
    "vector database",
    "embeddings",
    "PyTorch",
    "TensorFlow",
    "Hugging Face",
    "diffusion model",
    "multimodal",
    "prompt engineering",
    "agent",
    "agentic",
    "langchain",
    "openai",
    "anthropic",
  ],

  // ── Tier 3 filter — Disqualifying phrases ─────────────────────────────────
  // Jobs containing any of these phrases are automatically excluded.
  // Use this to filter out roles you are not eligible or ready for.
  excludeKeywords: [
    "10+ years",
    "10 years experience",
    "PhD required",
    "PhD preferred",
    "requires PhD",
    "security clearance required",
    "must be US citizen",
    "staff engineer",
    "principal engineer",
    "director of",
    "VP of",
    "vice president",
  ],

  // ── Preferred locations ────────────────────────────────────────────────────
  // Passed to scrapers as a soft preference for geo-filtering.
  // Use "Remote" to include fully remote listings.
  preferredLocations: [
    "Austin, TX",
    "Houston, TX",
    "Remote",
    "San Francisco, CA",
    "New York, NY",
  ],

  // ── Scraper settings ──────────────────────────────────────────────────────
  scraper: {
    // Maximum number of job listings to collect per source in a single run.
    maxJobsPerSource: 50,

    // Run Playwright browser in headless mode (true = no visible window).
    // Set to false when debugging a scraper to watch it work.
    headless: true,

    // Milliseconds to wait between Playwright actions (0 = no artificial delay).
    // Increase to ~100–500 if a site rate-limits or detects automation.
    slowMo: 0,
  },
};
