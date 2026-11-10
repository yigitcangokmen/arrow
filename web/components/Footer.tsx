import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <a href="/#trust">Trust table</a>
        <a href="https://github.com/yigitcangokmen/arrow" target="_blank" rel="noopener noreferrer">GitHub</a>
        <span className={styles.note}>Built at NEAR HACKATHON</span>
      </div>
    </footer>
  );
}
