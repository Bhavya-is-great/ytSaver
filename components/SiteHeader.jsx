import Image from "next/image";
import logo from "@/assets/logo.png";
import styles from "@/css/components/SiteHeader.module.css";

export default function SiteHeader() {
  return (
    <header className={styles.header} data-brand>
      <div className={styles.brand}>
        <Image src={logo} alt="ytSaver logo" className={styles.logo} priority />
        <div>
          <strong>ytSaver</strong>
          <p>Black edition</p>
        </div>
      </div>

      <span className={styles.version}>v0.0.1 beta</span>
    </header>
  );
}
