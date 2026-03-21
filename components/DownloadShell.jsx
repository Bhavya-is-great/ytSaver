"use client";

import { useEffect, useEffectEvent, useRef, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import AmbientBackdrop from "@/components/AmbientBackdrop";
import HeroSection from "@/components/HeroSection";
import FeatureStrip from "@/components/FeatureStrip";
import ResultsPanel from "@/components/ResultsPanel";
import SiteHeader from "@/components/SiteHeader";
import { buildDownloadPath } from "@/utils/url-path";
import styles from "@/css/components/DownloadShell.module.css";

gsap.registerPlugin(ScrollTrigger);

const featureItems = [
  {
    eyebrow: "Fast input",
    title: "Long paste bar, one clear action.",
    text: "The hero is now built around a single wide input row so the URL field feels primary immediately.",
  },
  {
    eyebrow: "Instant feedback",
    title: "Loading starts in place, right under the hero.",
    text: "The formats panel now lives directly below the form, so the user always sees the state change where they are looking.",
  },
  {
    eyebrow: "Sharable",
    title: "Each video still gets its own ytSaver route.",
    text: "Users can paste a link or open a path-based downloader URL and land straight in the same flow.",
  },
];

export default function DownloadShell({ initialUrl = "" }) {
  const router = useRouter();
  const shellRef = useRef(null);
  const lastLookupRef = useRef("");
  const [url, setUrl] = useState(initialUrl);
  const [payload, setPayload] = useState(null);
  const [feedback, setFeedback] = useState({
    success: false,
    message: "",
    data: null,
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-brand]", {
        opacity: 0,
        y: -18,
        duration: 0.65,
        ease: "power2.out",
      });

      gsap.from("[data-hero-copy]", {
        opacity: 0,
        y: 42,
        duration: 0.82,
        ease: "power3.out",
      });

      gsap.from("[data-hero-form]", {
        opacity: 0,
        y: 28,
        duration: 0.86,
        delay: 0.08,
        ease: "power3.out",
      });

      gsap.from("[data-result-panel]", {
        opacity: 0,
        y: 34,
        duration: 0.92,
        delay: 0.14,
        ease: "power3.out",
      });

      gsap.utils.toArray("[data-reveal]").forEach((item, index) => {
        gsap.from(item, {
          opacity: 0,
          y: 44,
          duration: 0.78,
          ease: "power3.out",
          delay: index * 0.04,
          scrollTrigger: {
            trigger: item,
            start: "top 86%",
          },
        });
      });
    }, shellRef);

    return () => ctx.revert();
  }, []);

  async function handleLookup(nextUrl, syncRoute = true) {
    const normalizedUrl = nextUrl.trim();

    if (!normalizedUrl) {
      setPayload(null);
      setFeedback({
        success: false,
        message: "",
        data: "Paste a YouTube link to continue.",
      });
      return;
    }

    lastLookupRef.current = normalizedUrl;
    setIsLoading(true);
    setPayload(null);
    setFeedback({
      success: false,
      message: "Resolving video and preparing formats...",
      data: normalizedUrl,
    });

    if (syncRoute) {
      startTransition(() => {
        router.replace(buildDownloadPath(normalizedUrl), { scroll: false });
      });
    }

    try {
      const response = await fetch("/api/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: normalizedUrl }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result?.data || result?.message || "Unable to fetch video details.");
      }

      setPayload(result.data);
      setFeedback({
        success: true,
        message: result.message || "Formats are ready.",
        data: result.data?.title || null,
      });
    } catch (error) {
      setPayload(null);
      setFeedback({
        success: false,
        message: "",
        data: error.message || "Something went wrong.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  const runPathLookup = useEffectEvent((nextUrl) => {
    void handleLookup(nextUrl, false);
  });

  useEffect(() => {
    if (!initialUrl || initialUrl === lastLookupRef.current) {
      if (initialUrl) {
        setUrl(initialUrl);
      }
      return;
    }

    setUrl(initialUrl);
    runPathLookup(initialUrl);
  }, [initialUrl]);

  return (
    <main ref={shellRef} className={styles.shell}>
      <AmbientBackdrop />
      <SiteHeader />

      <section className={styles.heroSection}>
        <div className={styles.heroGrid}>
          <HeroSection
            url={url}
            setUrl={setUrl}
            feedback={feedback}
            isLoading={isLoading}
            onLookup={handleLookup}
          />
          <ResultsPanel payload={payload} feedback={feedback} isLoading={isLoading} />
        </div>
      </section>

      <section className={styles.featureSection}>
        <div className={styles.sectionHeader} data-reveal>
          <span className={styles.kicker}>ytSaver</span>
          <h2>Built around the link input first, with formats directly below it.</h2>
        </div>

        <FeatureStrip items={featureItems} />
      </section>
    </main>
  );
}
