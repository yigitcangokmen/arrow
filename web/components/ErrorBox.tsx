import type { ReactNode } from "react";
import styles from "./ErrorBox.module.css";

/** `fallback` is what the user can do instead (the API's `fallback` field). */
export function ErrorBox({ title, children, fallback }: { title: string; children?: ReactNode; fallback?: string }) {
  return (
    <div className={styles.box} role="alert">
      <strong>{title}</strong>
      {children ? <div>{children}</div> : null}
      {fallback ? <p className={styles.fallback}>{fallback}</p> : null}
    </div>
  );
}
