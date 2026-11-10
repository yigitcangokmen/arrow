// JSON with every non-ASCII char written as a \uXXXX escape: editor-proof, parses to the same value (WS6 card 2.3).
export const asciiJson = (v: unknown): string =>
  JSON.stringify(v, null, 2).replace(/[\u0080-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")) + "\n";
