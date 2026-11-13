import { Skeleton } from "../components/Skeleton.tsx";

// Shown by Next while a server page waits for the chain (DEC 1.8 loading state: skeleton cards), with one visible line saying so.
export default function Loading() {
  return (
    <div data-ready="false" aria-busy="true">
      <p role="status" style={{ margin: "var(--sp-4) 0 var(--sp-5)", color: "var(--muted)" }}>Reading the chain. This page usually appears within a few seconds.</p>
      <Skeleton height={120} />
      <div style={{ height: 16 }} />
      <Skeleton height={220} />
    </div>
  );
}
