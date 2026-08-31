const LOWER = /^[^A-Za-z]*[a-z]/;

function capitalise(word: string): string {
  const i = word.search(/[A-Za-z]/);
  if (i === -1) return word;
  return word.slice(0, i) + word[i]!.toUpperCase() + word.slice(i + 1);
}

function isUpper(s: string): boolean {
  return /[A-Z]/.test(s) && s === s.toUpperCase();
}

function isCapitalised(s: string): boolean {
  return LOWER.test(s) === false && /[A-Za-z]/.test(s) && s !== s.toUpperCase();
}

/**
 * Re-cases a lowercase replacement to match the source it stands in for, so
 * `Color` yields `Colour` and `MOVIE THEATER` yields `CINEMA`.
 */
export function matchCase(source: string, replacement: string): string {
  if (!/[A-Za-z]/.test(source)) return replacement;

  const sourceWords = source.split(/(\s+|-)/).filter((w) => /[A-Za-z]/.test(w));
  if (sourceWords.length === 0) return replacement;

  if (sourceWords.every(isUpper)) return replacement.toUpperCase();

  const capitalisedWords = sourceWords.filter(isCapitalised).length;

  // Every word capitalised in a multi-word source means title case, so title-case the result too.
  if (sourceWords.length > 1 && capitalisedWords === sourceWords.length) {
    return replacement.replace(/[A-Za-z][a-z']*/g, (w) => capitalise(w));
  }

  if (isCapitalised(sourceWords[0]!) || isUpper(sourceWords[0]!)) {
    return capitalise(replacement);
  }

  return replacement;
}
