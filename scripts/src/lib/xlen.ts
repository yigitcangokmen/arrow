// X (twitter-text style) weighted length: URLs count 23, most Latin text 1, CJK and other wide scripts 2. Limit 280.
const URL_RE = /https?:\/\/\S+/g;

function weight(cp: number): number {
  const narrow = (cp >= 0 && cp <= 4351) || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247);
  return narrow ? 1 : 2;
}

export function weightedLength(text: string): number {
  let n = 0;
  const noUrls = text.replace(URL_RE, () => {
    n += 23;
    return "";
  });
  for (const ch of noUrls) n += weight(ch.codePointAt(0) as number);
  return n;
}
