/**
 * The language tag handed to `SpeechRecognition`.
 *
 * **The browser's locale is not the same thing as a tag the speech engine
 * accepts.** `navigator.language` reports where the reader is — `en-AE` for an
 * English speaker in the Emirates — and the engine only recognises the
 * region-language pairs it has models for. `en-AE` is not one of them: Chrome
 * offers en-US, en-GB, en-AU, en-IN and a dozen more, and none of them is the
 * Emirates. Handing it an unlisted tag is how a perfectly good English speaker
 * gets transcribed badly by an engine that never chose an English model.
 *
 * **Conservative on purpose: a tag is only rewritten when it is known to be
 * wrong.** The lists below are the tags this file is confident the engine
 * knows, and they are nowhere near all of them. If a reader's language is not
 * listed at all — Armenian, Georgian, Thai — the original tag is passed through
 * untouched, exactly as before. Rewriting on ignorance would be worse than the
 * bug: it would answer an unrecognised tag by transcribing somebody's Armenian
 * as English, which is a failure they cannot even diagnose.
 *
 * So the only case that changes is the one we can prove: the base language is
 * known, and the region attached to it is not.
 */

/**
 * Region-qualified tags the engine is known to accept, by base language.
 *
 * First in each list is the fallback for that language — the variant an
 * unlisted region resolves to.
 */
const KNOWN: Record<string, string[]> = {
  /*
   * `en-GB` leads rather than `en-US`, because the regions that fall through to
   * it are the ones with no model of their own — the Gulf, much of Africa and
   * Asia — where English is likelier to have arrived through British spelling
   * and vocabulary than American.
   */
  en: [
    'en-GB',
    'en-US',
    'en-AU',
    'en-CA',
    'en-IN',
    'en-IE',
    'en-NZ',
    'en-ZA',
    'en-SG',
    'en-PH',
    'en-HK',
    'en-NG',
    'en-KE',
    'en-PK',
  ],
  ar: ['ar-SA', 'ar-AE', 'ar-EG', 'ar-JO', 'ar-LB', 'ar-MA', 'ar-QA', 'ar-KW', 'ar-BH', 'ar-DZ'],
  es: ['es-ES', 'es-MX', 'es-AR', 'es-CO', 'es-CL', 'es-PE', 'es-US', 'es-VE'],
  fr: ['fr-FR', 'fr-CA', 'fr-BE', 'fr-CH'],
  de: ['de-DE', 'de-AT', 'de-CH'],
  pt: ['pt-PT', 'pt-BR'],
  it: ['it-IT', 'it-CH'],
  nl: ['nl-NL', 'nl-BE'],
  ru: ['ru-RU'],
  zh: ['zh-CN', 'zh-TW', 'zh-HK'],
  ja: ['ja-JP'],
  ko: ['ko-KR'],
  hi: ['hi-IN'],
  tr: ['tr-TR'],
  pl: ['pl-PL'],
  sv: ['sv-SE'],
  da: ['da-DK'],
  nb: ['nb-NO'],
  fi: ['fi-FI'],
  cs: ['cs-CZ'],
  el: ['el-GR'],
  he: ['he-IL'],
  id: ['id-ID'],
  th: ['th-TH'],
  vi: ['vi-VN'],
  uk: ['uk-UA'],
  ro: ['ro-RO'],
  hu: ['hu-HU'],
};

/**
 * Turns a browser locale into a tag the speech engine will accept.
 *
 * Empty or malformed input answers `en-US`, which is the one tag every
 * implementation of this API has.
 */
export function speechLang(locale: string | undefined | null): string {
  const tag = (locale ?? '').trim();
  if (!tag) return 'en-US';

  // `en_AE` from a stray Unix-style locale, and casing nobody promised:
  // BCP-47 is case-insensitive and the lists here are lower-base, upper-region.
  const parts = tag.replace(/_/g, '-').split('-');
  const base = (parts[0] ?? '').toLowerCase();
  if (!base) return 'en-US';

  const known = KNOWN[base];

  // An unknown language: leave it exactly as it came. See the note above about
  // why guessing here is worse than doing nothing.
  if (!known) return tag;

  // A bare language — `en`, with no region. The engine wants a region, and this
  // is the one case where the language's default is unambiguously right.
  if (parts.length === 1) return known[0];

  const region = (parts[parts.length - 1] ?? '').toUpperCase();
  const normalised = `${base}-${region}`;

  return known.includes(normalised) ? normalised : known[0];
}
