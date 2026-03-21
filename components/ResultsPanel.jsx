import styles from "@/css/components/ResultsPanel.module.css";

function LoadingState() {
  return (
    <div className={styles.loadingState}>
      <div className={styles.loadingHeader}>
        <span />
        <span />
      </div>
      <div className={styles.loadingThumb} />
      <div className={styles.loadingFormats}>
        <div />
        <div />
        <div />
        <div />
      </div>
    </div>
  );
}

function ResultGroup({ title, items }) {
  return (
    <div className={styles.group}>
      <div className={styles.groupHeader}>
        <h3>{title}</h3>
        <span>{items.length} options</span>
      </div>

      <div className={styles.list}>
        {items.map((item) => (
          <a
            key={item.itag}
            href={item.url}
            className={styles.item}
          >
            <div className={styles.itemBody}>
              <div className={styles.itemTop}>
                <strong>{item.quality}</strong>
                {item.mode ? <em className={styles.chip}>{item.mode}</em> : null}
              </div>
              <p>{item.details}</p>
            </div>
            <span>{item.type}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

export default function ResultsPanel({ payload, feedback, isLoading }) {
  const helperText = isLoading
    ? "We are resolving the fastest direct streams and the merged HD options now."
    : payload
      ? "Instant downloads start fastest. Merged HD gives better quality with a short server-side combine step."
      : "Paste a YouTube link above and the format list will appear here.";

  return (
    <aside className={styles.wrapper} data-result-panel>
      <div className={styles.header}>
        <div>
          <span className={styles.kicker}>Formats</span>
          <h2>{isLoading ? "Loading formats..." : "Download panel"}</h2>
        </div>
        <p>{helperText}</p>
      </div>

      {isLoading ? <LoadingState /> : null}

      {!isLoading && payload ? (
        <div className={styles.content}>
          <div className={styles.summary}>
            <div
              className={styles.poster}
              style={payload.thumbnail ? { backgroundImage: `url(${payload.thumbnail})` } : undefined}
            />
            <div className={styles.summaryText}>
              <span>{payload.author}</span>
              <h3>{payload.title}</h3>
              <p>{payload.description}</p>
            </div>
          </div>

          <div className={styles.metaRow}>
            <div className={styles.metaCard}>
              <span>Duration</span>
              <strong>{payload.duration}</strong>
            </div>
            <div className={styles.metaCard}>
              <span>Formats</span>
              <strong>{payload.formats.video.length + payload.formats.audio.length}</strong>
            </div>
            <div className={styles.metaCard}>
              <span>Creator</span>
              <strong>{payload.author}</strong>
            </div>
          </div>

          <div className={styles.groups}>
            <ResultGroup title="Video" items={payload.formats.video} />
            <ResultGroup title="Audio" items={payload.formats.audio} />
          </div>
        </div>
      ) : null}

      {!isLoading && !payload ? (
        <div className={styles.emptyState}>
          <strong>{feedback?.data || "No video loaded yet."}</strong>
          <p>{feedback?.data ? "Try another public YouTube video or retry in a moment." : "Paste a link above and the formats will load directly in this section."}</p>
        </div>
      ) : null}
    </aside>
  );
}
