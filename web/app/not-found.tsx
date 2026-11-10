import Link from "next/link";
import { EmptyState } from "../components/EmptyState.tsx";

export default function NotFound() {
  return (
    <div data-ready="true">
      <EmptyState title="Page not found">
        <Link href="/">Back to the listings</Link>
      </EmptyState>
    </div>
  );
}
