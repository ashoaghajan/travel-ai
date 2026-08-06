import { describe, expect, it } from 'vitest';
import { formatBytes } from './bytes';
import { formatCurrency } from './currency';
import { cx } from './cx';

describe('formatCurrency', () => {
  it('formats whole dollars with a thousands separator', () => {
    expect(formatCurrency(2248)).toBe('$2,248');
  });

  it('drops the cents', () => {
    expect(formatCurrency(1124.4)).toBe('$1,124');
    expect(formatCurrency(1124.6)).toBe('$1,125');
  });

  it('handles zero', () => {
    expect(formatCurrency(0)).toBe('$0');
  });

  it('formats a four-figure total', () => {
    expect(formatCurrency(3898)).toBe('$3,898');
  });
});

describe('formatBytes', () => {
  it('reports small values in bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
  });

  it('switches to kilobytes at 1024', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(2048)).toBe('2.0 KB');
  });

  it('switches to megabytes', () => {
    expect(formatBytes(1024 * 1024 * 3)).toBe('3.0 MB');
  });

  it('keeps one decimal place', () => {
    expect(formatBytes(4700)).toBe('4.6 KB');
  });
});

describe('cx', () => {
  it('joins class names', () => {
    expect(cx('a', 'b')).toBe('a b');
  });

  it('drops falsy values', () => {
    expect(cx('a', false, null, undefined, 'b')).toBe('a b');
  });

  it('returns an empty string when nothing is truthy', () => {
    expect(cx(false, undefined)).toBe('');
  });
});
