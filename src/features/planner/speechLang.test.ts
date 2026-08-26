import { describe, expect, it } from 'vitest';
import { speechLang } from './speechLang';

describe('speechLang', () => {
  it('keeps a region the engine has a model for', () => {
    expect(speechLang('en-GB')).toBe('en-GB');
    expect(speechLang('fr-CA')).toBe('fr-CA');
    expect(speechLang('pt-BR')).toBe('pt-BR');
  });

  /*
   * The bug this file exists for. `en-AE` is what a browser in the Emirates
   * reports and is not a pair any engine ships, so it has to become English
   * the engine knows rather than be passed along.
   */
  it('rewrites a region the engine does not have to that language default', () => {
    expect(speechLang('en-AE')).toBe('en-GB');
    expect(speechLang('en-QA')).toBe('en-GB');
    expect(speechLang('fr-SN')).toBe('fr-FR');
  });

  it('leaves an unknown language completely alone', () => {
    // Guessing here would transcribe Armenian as English, so it must not.
    expect(speechLang('hy-AM')).toBe('hy-AM');
    expect(speechLang('ka-GE')).toBe('ka-GE');
  });

  it('gives a bare language the region the engine requires', () => {
    expect(speechLang('en')).toBe('en-GB');
    expect(speechLang('de')).toBe('de-DE');
  });

  it('accepts the casing and separators browsers actually produce', () => {
    expect(speechLang('en_AE')).toBe('en-GB');
    expect(speechLang('EN-gb')).toBe('en-GB');
  });

  it('falls back to the one tag every implementation has', () => {
    expect(speechLang('')).toBe('en-US');
    expect(speechLang(undefined)).toBe('en-US');
    expect(speechLang(null)).toBe('en-US');
  });
});
