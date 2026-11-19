import { describe, expect, it } from 'vitest';

import { CERT_FORMAT, VIR_VERSION } from '../src/index.js';

describe('public surface', () => {
  it('exposes the IR and certificate wire versions', () => {
    expect(VIR_VERSION).toBe(1);
    expect(CERT_FORMAT).toBe('vouch/cert@1');
  });
});
