import styles from "@/css/ui/TextInput.module.css";

export default function TextInput({ ariaLabel, ...props }) {
  return <input className={styles.input} aria-label={ariaLabel} {...props} />;
}
