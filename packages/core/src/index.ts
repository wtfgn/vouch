/**
 * @vouch/core — the pure core of Vouch.
 *
 * Layering (see ARCHITECTURE.md and §9.4 of VOUCH-PLAN.md):
 *
 *   parse → lower → diff → classify → witness → shrink → certify
 *
 * Every module in this package is a pure function over plain data. No
 * filesystem, network, clock, or environment access is permitted here — the
 * Biome boundary rule in `biome.json` (F0.2) enforces it. I/O belongs to
 * `acquirer`, `registry`, and the CLI.
 *
 * Scaffold status: this file reserves the package entry point. The IR
 * vocabulary (F0.4) lands here next.
 */

/** Wire version of the Vouch IR; bump only alongside a migration. */
export const VIR_VERSION = 1 as const;

/** Wire version of the certificate format (VOUCH-PLAN.md §9.6). */
export const CERT_FORMAT = 'vouch/cert@1' as const;
