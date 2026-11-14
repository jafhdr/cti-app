#!/usr/bin/env node
// Offline, read-only Phase 2C evaluator. The input is an independently adjudicated export.
const { readFileSync } = require('node:fs');
const { evaluateValidation } = require('./dist/src/intelligence/next-step-validation.js');

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
}

try {
  const input = JSON.parse(readFileSync(option('--input'), 'utf8'));
  const clearance = option('--max-tlp');
  if (!['CLEAR', 'GREEN', 'AMBER', 'AMBER_STRICT', 'RED'].includes(clearance)) throw new Error('Invalid --max-tlp');
  const result = evaluateValidation(input, option('--tenant'), clearance);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
