import { useEffect, useRef, useState } from "react";

const MIN_MS = 700; // floor so a cached load still reads as deliberate
const FADE_MS = 460;

/**
 * Load screen, shown on every visit.
 *
 * The counter is tied to real readiness rather than a fixed timer: it eases
 * toward 90% while the document is still loading, and only runs to 100 once
 * `readyState` is complete. That way a slow connection genuinely sits at a lower
 * number instead of the bar lying about progress.
 */
export default function Splash() {
  const [pct, setPct] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const raf = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    let ready = document.readyState === "complete";

    const onLoad = () => { ready = true; };
    window.addEventListener("load", onLoad);

    if (reduce) {
      // No animation, but still acknowledge the load before handing over.
      setPct(100);
      const t = setTimeout(() => setGone(true), 260);
      return () => { clearTimeout(t); window.removeEventListener("load", onLoad); };
    }

    let value = 0;
    const step = () => {
      const elapsed = performance.now() - started;
      const target = ready && elapsed >= MIN_MS ? 100 : 90;
      // Ease toward the target; the gap shrinks so it decelerates near the cap.
      value += Math.max(0.6, (target - value) * 0.055);
      if (value >= 100) {
        value = 100;
        setPct(100);
        setLeaving(true);
        setTimeout(() => setGone(true), FADE_MS);
        return;
      }
      setPct(Math.floor(value));
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener("load", onLoad);
    };
  }, []);

  if (gone) return null;

  return (
    <div className={`splash ${leaving ? "leaving" : ""}`} role="presentation">
      <div className="splash-inner">
        <span className="splash-mark">
          <svg viewBox="0 0 24 24" width="40" height="40">
            <path d="M4 4l16 16M20 4L4 20" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </span>
        <span className="splash-word">X Downloader</span>
        <span className="splash-count">{pct}</span>
        <span className="splash-bar">
          <i style={{ transform: `scaleX(${pct / 100})` }} />
        </span>
      </div>
    </div>
  );
}
