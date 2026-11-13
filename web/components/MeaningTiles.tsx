import styles from "./MeaningTiles.module.css";

/** What the three parts of a verdict mean, in plain words; /try adds a fourth tile for the 51-answer cap. */
export function MeaningTiles({ withAnswers = false }: { withAnswers?: boolean }) {
  return (
    <ul className={styles.tiles} aria-label="What the verdict means">
      <li><b>BUY</b> every structural check passed and the AI voted to buy; otherwise PASS</li>
      <li><b>fit</b> how well the file matches what you asked, 1 to 5; the lower of the AI&apos;s score and a rule score</li>
      <li><b>novelty</b> how much of it is not already in your own list, 1 to 5; computed by code, not by the AI</li>
      {withAnswers ? (
        <li><b>51 answers</b> everything an inspection can say fits in 51 states. Run time and instruction count are public on top of that</li>
      ) : null}
    </ul>
  );
}
