/**
 * Large extruded X sitting off the right edge of the backdrop.
 *
 * Rather than pull in a WebGL renderer for one static mark, the depth is built
 * from stacked layers: each stroke of the X is repeated a few times, pushed back
 * along Z with a darker face, so the silhouette reads as a solid extruded body
 * with a lit front.
 *
 * The shading is baked into each layer's gradient rather than applied with
 * `filter: brightness()`. A CSS filter on a layer inside a preserve-3d scene
 * forces its own compositing pass, and nine of them dropped the page from ~55fps
 * to ~7. Plain background colours keep the whole thing on the fast path, so the
 * only thing that ever animates is a single transform on the parent.
 */

const DEPTH_LAYERS = 5;
const STEP_Z = 11; // px between layers

/** Front face stops, darkened toward the back so the extrusion falls off. */
function faceGradient(shade: number): string {
  const mix = (r: number, g: number, b: number) =>
    `rgb(${Math.round(r * shade)}, ${Math.round(g * shade)}, ${Math.round(b * shade)})`;
  return (
    `linear-gradient(135deg, ${mix(255, 255, 255)} 0%, ${mix(207, 224, 255)} 38%, ` +
    `${mix(127, 159, 216)} 68%, ${mix(60, 79, 120)} 100%)`
  );
}

export default function GlassX() {
  const layers = Array.from({ length: DEPTH_LAYERS }, (_, i) => {
    const t = i / (DEPTH_LAYERS - 1); // 0 = front face, 1 = deepest
    const shade = 1 - t * 0.72;
    const bg = faceGradient(shade);
    return (
      <div key={i} className="gx-layer" style={{ transform: `translateZ(${-i * STEP_Z}px)` }}>
        <span className="gx-bar gx-bar-a" style={{ background: bg }} />
        <span className="gx-bar gx-bar-b" style={{ background: bg }} />
      </div>
    );
  });

  return (
    <div className="gx" aria-hidden="true">
      <div className="gx-scene">
        <div className="gx-body">{layers}</div>
      </div>
    </div>
  );
}
