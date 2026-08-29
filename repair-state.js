#!/usr/bin/env node
/**
 * repair-state.js — local one-off helper (not for shipping live table data).
 *
 * Intentionally empty of party-specific values so the public repo stays clean.
 * If you need a live-table repair, keep a private script outside git (e.g.
 * LOCAL_NOTES / a private gist) and point DATA_DIR at your data-local.
 *
 *   DATA_DIR=./data-local node repair-state.js
 */
console.error(
  'repair-state.js has no bundled party fixes (repo is sanitized).\n' +
    'Use a private local script against DATA_DIR if you need a live repair.'
);
process.exit(1);
