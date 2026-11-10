import { TrustTable } from "../components/TrustTable.tsx";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div data-ready="true">
      <section className={styles.hero}>
        <h1>Inspect before you pay.</h1>
        <p className={styles.lead}>
          The buyer&apos;s AI reads the sealed data inside a TEE, and only a capped verdict (≤5.67 bits) comes back to the buyer.
        </p>
      </section>
      <TrustTable />
    </div>
  );
}
