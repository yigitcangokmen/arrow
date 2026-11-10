"use client";
import { ErrorBox } from "../components/ErrorBox.tsx";

// Generic text only: the error message and stack can carry request details, so they are not rendered.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div data-ready="true">
      <ErrorBox title="Something went wrong">
        <p>The page failed to load. Try again, and if it keeps failing, use the CLI path in the README.</p>
        <button type="button" onClick={reset}>Try again</button>
      </ErrorBox>
    </div>
  );
}
