/** Conservative bound for an unbroken token in the standard-font body column.
 * Hard line breaks retain every character and never add extraction hyphens. */
export const PDF_TOKEN_LIMIT = 48;

export function wrapPdfText(text: string, limit = PDF_TOKEN_LIMIT): string {
  return text.replace(/\S+/gu, (word) => {
    const characters = Array.from(word);
    if (characters.length <= limit) return word;
    const lines: string[] = [];
    while (characters.length > limit) {
      // Prefer a URL/path delimiter near the end of the line. Fall back to a
      // hard character break for a single long identifier, without a hyphen.
      const candidate = characters.slice(0, limit);
      const delimiter = candidate.findLastIndex(character => /[\/._?&=#-]/u.test(character));
      const end = delimiter >= limit / 2 ? delimiter + 1 : limit;
      lines.push(characters.splice(0, end).join(''));
    }
    lines.push(characters.join(''));
    return lines.join('\n');
  });
}
