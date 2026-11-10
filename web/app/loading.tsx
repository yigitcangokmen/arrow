import { Skeleton } from "../components/Skeleton.tsx";

// Shown by Next while a server page waits for the chain (DEC 1.8 loading state: skeleton cards).
export default function Loading() {
  return (
    <div data-ready="false" aria-busy="true">
      <Skeleton height={120} />
      <div style={{ height: 16 }} />
      <Skeleton height={220} />
    </div>
  );
}
