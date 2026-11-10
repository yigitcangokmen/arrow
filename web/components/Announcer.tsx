/**
 * One always-mounted polite live region per page. A live region that is created together with its text is skipped by NVDA and
 * JAWS, so results are announced by changing the text of this element, which exists from the first render.
 */
export function Announcer({ text }: { text: string }) {
  return (
    <p role="status" aria-live="polite" className="sr-only" data-announcer="">
      {text}
    </p>
  );
}
