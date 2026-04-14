'use strict';

require('dotenv').config();

const { runScraper } = require('./agents/scraper');

runScraper().catch(err => {
  console.error(err);
  process.exit(1);
});
