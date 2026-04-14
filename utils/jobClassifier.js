'use strict';

const EMPLOYMENT_TYPE_OPTIONS = [
  { name: 'Internship', color: 'purple' },
  { name: 'Full-Time', color: 'green' },
  { name: 'Unknown', color: 'gray' },
];

const EXPERIENCE_LEVEL_OPTIONS = [
  { name: 'Internship', color: 'purple' },
  { name: 'Entry Level', color: 'blue' },
  { name: 'Associate', color: 'green' },
  { name: 'Mid Level', color: 'yellow' },
  { name: 'Senior', color: 'orange' },
  { name: 'Staff+', color: 'red' },
  { name: 'Unknown', color: 'gray' },
];

const VALID_EMPLOYMENT_TYPES = new Set(
  EMPLOYMENT_TYPE_OPTIONS.map(option => option.name)
);

const VALID_EXPERIENCE_LEVELS = new Set(
  EXPERIENCE_LEVEL_OPTIONS.map(option => option.name)
);

const INTERNSHIP_PATTERNS = [
  /\bintern(ship)?\b/i,
  /\bsummer intern(ship)?\b/i,
  /\bfall intern(ship)?\b/i,
  /\bspring intern(ship)?\b/i,
  /\bmachine learning intern(ship)?\b/i,
  /\bai intern(ship)?\b/i,
  /\bdata science intern(ship)?\b/i,
  /\brobotics intern(ship)?\b/i,
  /\bresearch intern(ship)?\b/i,
  /\bco-?op\b/i,
  /\buniversity intern(ship)?\b/i,
];

const FULL_TIME_PATTERNS = [
  /\bfull[\s-]?time\b/i,
  /\bregular employee\b/i,
  /\bpermanent employee\b/i,
];

const ENTRY_LEVEL_PATTERNS = [
  /\bentry[\s-]?level\b/i,
  /\bnew grad(uate)?\b/i,
  /\bnew graduate\b/i,
  /\buniversity graduate\b/i,
  /\bgraduate program\b/i,
  /\bearly career\b/i,
  /\bcampus hire\b/i,
];

const ASSOCIATE_PATTERNS = [
  /\bassociate (engineer|developer|scientist|researcher|analyst)\b/i,
  /\bassociate software engineer\b/i,
  /\bassociate data scientist\b/i,
];

const MID_LEVEL_PATTERNS = [
  /\bmid[\s-]?level\b/i,
  /\bintermediate\b/i,
  /\b1\+?\s+years?\b/i,
  /\b2\+?\s+years?\b/i,
  /\b3\+?\s+years?\b/i,
  /\b1\s*-\s*3\s+years?\b/i,
  /\b2\s*-\s*4\s+years?\b/i,
];

const SENIOR_LEVEL_PATTERNS = [
  /\bsenior\b/i,
  /\bsr\.?\b/i,
  /\blead\b/i,
  /\bprincipal\b/i,
];

const STAFF_PLUS_PATTERNS = [
  /\bstaff\b/i,
  /\bsenior staff\b/i,
  /\bdistinguished\b/i,
  /\barchitect\b/i,
  /\bfellow\b/i,
];

function buildHaystack(job) {
  return [
    job.title,
    job.description,
    job.cardText,
  ]
    .filter(Boolean)
    .join('\n');
}

function classifyEmploymentType(job) {
  const haystack = buildHaystack(job);

  if (INTERNSHIP_PATTERNS.some(pattern => pattern.test(haystack))) {
    return 'Internship';
  }

  if (FULL_TIME_PATTERNS.some(pattern => pattern.test(haystack))) {
    return 'Full-Time';
  }

  return 'Unknown';
}

function classifyExperienceLevel(job) {
  const haystack = buildHaystack(job);

  const isInternship = INTERNSHIP_PATTERNS.some(pattern => pattern.test(haystack));
  if (isInternship) {
    return 'Internship';
  }

  const isEntryLevel = ENTRY_LEVEL_PATTERNS.some(pattern => pattern.test(haystack));
  const isAssociate = ASSOCIATE_PATTERNS.some(pattern => pattern.test(haystack));
  const isStaffPlus = STAFF_PLUS_PATTERNS.some(pattern => pattern.test(haystack));
  const isSenior = SENIOR_LEVEL_PATTERNS.some(pattern => pattern.test(haystack));
  const isMidLevel = MID_LEVEL_PATTERNS.some(pattern => pattern.test(haystack));

  if (isStaffPlus) {
    return 'Staff+';
  }

  const matchedLevels = [
    isEntryLevel,
    isAssociate,
    isSenior,
    isMidLevel,
  ].filter(Boolean).length;

  if (matchedLevels > 1) {
    return 'Unknown';
  }

  if (isEntryLevel) {
    return 'Entry Level';
  }

  if (isAssociate) {
    return 'Associate';
  }

  if (isSenior) {
    return 'Senior';
  }

  if (isMidLevel) {
    return 'Mid Level';
  }

  return 'Unknown';
}

module.exports = {
  EMPLOYMENT_TYPE_OPTIONS,
  EXPERIENCE_LEVEL_OPTIONS,
  VALID_EMPLOYMENT_TYPES,
  VALID_EXPERIENCE_LEVELS,
  classifyEmploymentType,
  classifyExperienceLevel,
};
