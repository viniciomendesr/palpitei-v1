/** Language detection, kept out of `i18n.tsx` so it can be tested without JSX. */

export type Lang = 'pt' | 'en';

/**
 * Reads the visitor's preferred language. Only a Portuguese preference keeps the
 * pt-BR copy; everyone else gets English, so an international visitor is not
 * dropped into a language they cannot read. Returns null when the browser states
 * no preference at all, which leaves the pt-BR default in place.
 */
export function preferredLang(tags: readonly string[]): Lang | null {
  for (const tag of tags) {
    const base = tag.toLowerCase().split('-')[0];
    if (base === 'pt') return 'pt';
    if (base) return 'en';
  }
  return null;
}
