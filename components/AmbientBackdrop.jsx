"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import styles from "@/css/components/AmbientBackdrop.module.css";

export default function AmbientBackdrop() {
  const rootRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const blobs = gsap.utils.toArray("[data-blob]");

      gsap.to(blobs[0], {
        xPercent: 8,
        yPercent: -6,
        duration: 8,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });

      gsap.to(blobs[1], {
        xPercent: -7,
        yPercent: 9,
        duration: 10,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });

      gsap.to(blobs[2], {
        scale: 1.06,
        duration: 12,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });
    }, rootRef);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={rootRef} className={styles.backdrop} aria-hidden="true">
      <div className={styles.mesh} />
      <div className={styles.blobOne} data-blob />
      <div className={styles.blobTwo} data-blob />
      <div className={styles.blobThree} data-blob />
    </div>
  );
}
