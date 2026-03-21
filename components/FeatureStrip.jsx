import styles from "@/css/components/FeatureStrip.module.css";

export default function FeatureStrip({ items }) {
  return (
    <div className={styles.grid}>
      {items.map((item) => (
        <article key={item.title} className={styles.card} data-reveal>
          <span className={styles.eyebrow}>{item.eyebrow}</span>
          <h3>{item.title}</h3>
          <p>{item.text}</p>
        </article>
      ))}
    </div>
  );
}
