#!/usr/bin/env node
/**
 * `vouch` — the CLI entry point.
 *
 * Exit codes are part of the contract (VOUCH-PLAN.md §9.6):
 *   0 no breaking changes · 1 breaking · 2 config/usage · 3 unparseable ·
 *   4 internal error or exhausted budget.
 *
 * Scaffold status: F0.9 adds `vouch diff <base> <head>`. The `@vouch/core`
 * dependency is introduced with it, once there is an IR to print.
 */
import { Command } from 'commander';

const program = new Command();

program
  .name('vouch')
  .description('Prove what a schema change breaks, and see the client that breaks.')
  .version('0.0.0');

program.parse();
