import { describe, expect, it } from 'vitest';

import { formatPrice, shouldColor, Style, table } from '../src/output.js';

describe('shouldColor', () => {
  it('colours a terminal and not a pipe', () => {
    expect(shouldColor({ tty: true, noColorFlag: false, env: {} })).toBe(true);
    expect(shouldColor({ tty: false, noColorFlag: false, env: {} })).toBe(false);
  });

  it('honours NO_COLOR and --no-color over everything', () => {
    expect(shouldColor({ tty: true, noColorFlag: false, env: { NO_COLOR: '1' } })).toBe(false);
    expect(shouldColor({ tty: true, noColorFlag: true, env: { FORCE_COLOR: '1' } })).toBe(false);
  });

  it('lets FORCE_COLOR win for a log that renders escapes', () => {
    expect(shouldColor({ tty: false, noColorFlag: false, env: { FORCE_COLOR: '1' } })).toBe(true);
    expect(shouldColor({ tty: false, noColorFlag: false, env: { FORCE_COLOR: '0' } })).toBe(false);
  });
});

describe('Style', () => {
  it('emits nothing at all when disabled, so output is diffable', () => {
    expect(new Style(false).green('ok')).toBe('ok');
    expect(new Style(true).green('ok')).not.toBe('ok');
  });
});

describe('formatPrice', () => {
  it('quotes per million, which is how providers quote', () => {
    expect(formatPrice(0.000004)).toBe('$4.00/M');
    expect(formatPrice(5e-8)).toBe('$0.050/M');
  });

  it('says free rather than $0.00', () => {
    expect(formatPrice(0)).toBe('free');
  });

  it('shows an unpriced model as unknown rather than as free', () => {
    expect(formatPrice(null)).toBe('—');
    expect(formatPrice(undefined)).toBe('—');
  });
});

describe('table', () => {
  it('pads to the longest label', () => {
    expect(table([['id', 'a'], ['runtime', 'hermes']])).toEqual(['id       a', 'runtime  hermes']);
  });
});
