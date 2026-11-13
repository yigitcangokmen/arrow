import Link from "next/link";
import { PageHead } from "../components/Section.tsx";
import styles from "./not-found.module.css";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div data-ready="true">
      <PageHead eyebrow="404" title="Page not found.">
        This address has no page. The demo and the listings are one click away.
      </PageHead>
      <p className={styles.actions}>
        <Link className={styles.primary} href="/try">Run the demo, free</Link>
        <Link className={styles.secondary} href="/">Back to the home page</Link>
      </p>
    </div>
  );
}
