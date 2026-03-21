import styles from "@/css/ui/Button.module.css";

export default function Button({ children, isLoading = false, ...props }) {
  return (
    <button className={styles.button} disabled={isLoading || props.disabled} {...props}>
      <span className={styles.label}>{isLoading ? "Loading..." : children}</span>
    </button>
  );
}
