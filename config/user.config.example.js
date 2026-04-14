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
  // A job must match at least one of these title phrases (case-insensitive
  // substring) to pass the first filter stage.
  jobTitles: [
    "Software Engineer",
    "Software Developer",
    "Full Stack Engineer",
    "Full Stack Developer",
    "Backend Engineer",
    "Backend Developer",
    "Frontend Engineer",
    "Frontend Developer",
    "Product Engineer",
    "Platform Engineer",
    "Infrastructure Engineer",
    "Cloud Engineer",
    "DevOps Engineer",
    "Site Reliability Engineer",
    "SRE",
    "Security Engineer",
    "Cybersecurity Analyst",
    "Data Engineer",
    "Data Analyst",
    "Business Intelligence Analyst",
    "BI Analyst",
    "Analytics Engineer",
    "Solutions Engineer",
    "Forward Deployed Engineer",
    "Implementation Engineer",
    "Technical Implementation Engineer",
    "Product Designer",
    "UX Designer",
    "UI Designer",
    "AI Engineer",
    "ML Engineer",
    "Machine Learning Engineer",
    "Applied AI Engineer",
    "Applied ML Engineer",
    "LLM Engineer",
    "Generative AI Engineer",
    "AI/ML Engineer",
    "NLP Engineer",
    "Software Engineer Intern",
    "Data Analyst Intern",
    "Security Engineer Intern",
    "Product Design Intern",
    "AI Engineer Intern",
    "Machine Learning Intern",
    "Co-op",
  ],

  // Titles containing any of these phrases are rejected before deeper checks.
  blockedJobTitles: [
    "Recruiter",
    "Talent",
    "HR",
    "Legal",
    "Counsel",
    "Attorney",
    "Finance",
    "Accounting",
    "Account Executive",
    "Sales",
    "Marketing",
    "Communications",
    "Customer Support",
    "Customer Success",
    "Lead ",
    " Lead",
    "Staff",
    "Principal",
    "Manager",
    "Director",
    "Vice President",
    "Chief ",
  ],

  // ── Tier 2 filter — Keyword matching ──────────────────────────────────────
  // A job must mention at least one of these keywords in its title,
  // description, card text, or company context to pass the second filter stage.
  keywords: [
    "software",
    "developer",
    "engineering",
    "backend",
    "frontend",
    "full stack",
    "platform",
    "infrastructure",
    "cloud",
    "devops",
    "site reliability",
    "security",
    "cybersecurity",
    "data",
    "analytics",
    "business intelligence",
    "sql",
    "python",
    "javascript",
    "typescript",
    "react",
    "node",
    "implementation",
    "deployment",
    "ux",
    "ui",
    "product design",
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
    "Seattle, WA",
    "Boston, MA",
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
