"use client";

import Button from "@/components/ui/Button";
import TextInput from "@/components/ui/TextInput";
import styles from "@/css/components/HeroSection.module.css";

const SAMPLE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

export default function HeroSection({ url, setUrl, feedback, isLoading, onLookup }) {
  async function handleSubmit(event) {
    event.preventDefault();
    await onLookup(url, true);
  }

  function handleSampleFill() {
    setUrl(SAMPLE_URL);
  }

  return (
    <section className={styles.hero}>
      <div className={styles.copy} data-hero-copy>
        <span className={styles.kicker}>ytSaver</span>
        <h1>
          YouTube <span>Video</span> Download
        </h1>
        <p>Paste a link, hit one button, and get the formats without chasing the UI.</p>
      </div>

      <div className={styles.formWrap} data-hero-form>
        <div className={styles.formHeader}>
          <span className={styles.formEyebrow}>Paste URL</span>
          <strong>Load formats instantly</strong>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <TextInput
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="Paste YouTube link here..."
            ariaLabel="Paste YouTube URL"
          />
          <Button type="submit" isLoading={isLoading}>
            Get format
          </Button>
        </form>

        <div className={styles.quickRow}>
          <button type="button" className={styles.quickButton} onClick={handleSampleFill}>
            Use sample
          </button>
          <span className={styles.routeHint}>The route updates with the video link automatically</span>
        </div>

        <p className={feedback?.success ? styles.successText : styles.infoText}>
          {feedback?.message || feedback?.data || "Formats will load in the panel below as soon as the request starts."}
        </p>
      </div>
    </section>
  );
}
