import { useEffect, useRef } from "react";

/**
 * White glass bubbles drifting down over the backdrop.
 *
 * The naive version of this drew each bubble live: a fresh radial gradient, a
 * rim arc, a specular dot and a `ctx.filter = blur(...)` per bubble per frame.
 * Canvas filters are re-rasterised on every call and that alone dragged the page
 * to well under 1 fps.
 *
 * Instead each depth tier is baked once into its own small offscreen canvas,
 * blur included. The frame loop then does nothing but set globalAlpha and
 * drawImage, which is a cheap blit. Particles are bucketed by tier so depth
 * order comes from the draw order and no per-frame sort is needed.
 */

const TIERS = 6; // depth levels; each gets one baked sprite
const SPRITE_R = 34; // bake radius in px, scaled down at draw time
const BASE_AREA_PER_BUBBLE = 16000;
const MAX_BUBBLES = 90;
const MIN_BUBBLES = 24;

interface Bubble {
  x: number;
  y: number;
  tier: number;
  scale: number;
  vy: number;
  vx: number;
  phase: number;
  drift: number;
  alpha: number;
}

/** Bake one bubble sprite: body, rim light, specular dot, blurred to taste. */
function bakeSprite(tier: number): HTMLCanvasElement {
  const depth = tier / (TIERS - 1); // 0 = far, 1 = near
  const blur = 3.0 - depth * 2.5;
  const pad = Math.ceil(blur * 3) + 4;
  const size = (SPRITE_R + pad) * 2;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;
  const cx = size / 2;
  const cy = size / 2;
  const r = SPRITE_R;

  g.filter = `blur(${blur.toFixed(2)}px)`; // paid once, not per frame

  // Body lit from the upper left, falling off to transparent at the edge.
  const body = g.createRadialGradient(cx - r * 0.36, cy - r * 0.4, r * 0.05, cx, cy, r);
  body.addColorStop(0, "rgba(255,255,255,1)");
  body.addColorStop(0.42, "rgba(255,255,255,0.9)");
  body.addColorStop(0.78, "rgba(255,255,255,0.42)");
  body.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = body;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();

  // Rim light on the lower right edge. This is what reads as volume.
  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.lineWidth = r * 0.085;
  g.beginPath();
  g.arc(cx, cy, r * 0.93, Math.PI * 0.12, Math.PI * 0.88);
  g.stroke();

  // Specular highlight.
  g.fillStyle = "rgba(255,255,255,0.95)";
  g.beginPath();
  g.arc(cx - r * 0.33, cy - r * 0.37, r * 0.16, 0, Math.PI * 2);
  g.fill();

  return c;
}

export default function SnowBubbles() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sprites: HTMLCanvasElement[] = Array.from({ length: TIERS }, (_, t) => bakeSprite(t));

    let width = 0;
    let height = 0;
    let buckets: Bubble[][] = [];
    let raf = 0;
    let running = true;

    const spawn = (tier: number, seeded: boolean): Bubble => {
      const depth = tier / (TIERS - 1);
      return {
        x: Math.random() * width,
        y: seeded ? Math.random() * height : -60 - Math.random() * 140,
        tier,
        scale: (0.032 + depth * 0.13 + Math.random() * 0.03) * 1.6,
        vy: 9 + depth * 36 + Math.random() * 9,
        vx: (Math.random() - 0.5) * (5 + depth * 9),
        phase: Math.random() * Math.PI * 2,
        drift: 0.35 + Math.random() * 0.8,
        alpha: 0.4 + depth * 0.58,
      };
    };

    const resize = () => {
      // Capping DPR at 1.5 halves the fill cost on retina for no visible loss
      // on soft-edged shapes like these.
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const total = Math.max(
        MIN_BUBBLES,
        Math.min(MAX_BUBBLES, Math.round((width * height) / BASE_AREA_PER_BUBBLE)),
      );
      buckets = Array.from({ length: TIERS }, () => []);
      for (let i = 0; i < total; i++) {
        const tier = i % TIERS;
        buckets[tier]!.push(spawn(tier, true));
      }
    };

    let last = performance.now();
    const frame = (now: number) => {
      if (!running) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      ctx.clearRect(0, 0, width, height);

      // Far tiers first, so nearer bubbles naturally overlap them.
      for (let t = 0; t < TIERS; t++) {
        const sprite = sprites[t]!;
        const w = sprite.width;
        const list = buckets[t]!;
        for (let i = 0; i < list.length; i++) {
          const b = list[i]!;
          if (!reduce.matches) {
            b.y += b.vy * dt;
            b.x += b.vx * dt;
            b.phase += b.drift * dt;
          }
          if (b.y - 60 > height) {
            list[i] = spawn(t, false);
            continue;
          }
          if (b.x < -80) b.x = width + 60;
          else if (b.x > width + 80) b.x = -60;

          const size = w * b.scale;
          const half = size / 2;
          const x = b.x + Math.sin(b.phase) * (2 + t) - half;
          const y = b.y - half;

          ctx.globalAlpha = b.alpha;
          ctx.drawImage(sprite, x, y, size, size);
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };

    // No point animating a backgrounded tab.
    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop-glow" />
      <div className="backdrop-vignette" />
      <canvas ref={canvasRef} className="backdrop-canvas" />
    </div>
  );
}
