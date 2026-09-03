import { useCallback, useEffect, useRef, useState } from "react";
import SnowBubbles from "./components/SnowBubbles";
import GlassX from "./components/GlassX";
import Splash from "./components/Splash";
import { API_BASE, bitrateLabel, downloadHref, previewSrc, type Media, type Post, type Variant } from "./types";

const X_LINK = /(?:twitter\.com|x\.com)\/[^/]+\/status(?:es)?\/(\d{10,25})/i;

type Status = "idle" | "loading" | "ready" | "error";

const STEPS = [
  { n: "01", t: "Copy the link", d: "Open the post on X and copy its address from the share menu or your browser bar." },
  { n: "02", t: "Paste it here", d: "The preview loads by itself. No button to press, no account, no captcha." },
  { n: "03", t: "Save the file", d: "Pick an item and download the original quality straight to your device." },
];

const FEATURES = [
  { t: "Original quality", d: "Video comes back at the highest bitrate X stores; photos at full resolution, not the compressed timeline copy." },
  { t: "Video, photos and GIFs", d: "Posts with several images arrive as a set you can page through and save individually or all at once." },
  { t: "Nothing is stored", d: "Files stream straight through to you. No queue, no cache, no copy kept on the server." },
  { t: "No account", d: "No login, no extension, no app. Works the same on desktop and phone." },
];

const FAQ = [
  { q: "Which links work?", a: "Any public post on x.com or twitter.com that contains a video, GIF or image. For example https://x.com/user/status/1234567890." },
  { q: "Can it fetch private or protected posts?", a: "No. Only posts that are publicly visible without logging in can be read, and that limit is deliberate." },
  { q: "What quality do I get?", a: "The best rendition X holds. Video is served as MP4 at the highest available bitrate, and images use the original file rather than a resized preview." },
  { q: "Do you keep my downloads?", a: "No. The server fetches the file and passes the bytes through to your browser as they arrive. Nothing is written to disk and no link history is kept." },
  { q: "Is there a limit?", a: "No counter and no signup wall. Please keep to content you have the right to save." },
];

export default function App() {
  const [link, setLink] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  // Index into the active item's variants. Reset whenever the item changes.
  const [quality, setQuality] = useState(0);

  // Guards a slow earlier request from overwriting a newer one.
  const requestSeq = useRef(0);
  const lastFetched = useRef("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const extract = useCallback(async (raw: string) => {
    const value = raw.trim();
    if (!value || value === lastFetched.current) return;
    lastFetched.current = value;

    const seq = ++requestSeq.current;
    setStatus("loading");
    setError("");
    setPost(null);

    try {
      const res = await fetch(`${API_BASE}/api/extract?url=${encodeURIComponent(value)}`);
      const data = await res.json();
      if (seq !== requestSeq.current) return; // superseded
      if (!res.ok) {
        setError(data?.error ?? `Request failed (${res.status})`);
        setStatus("error");
        return;
      }
      setPost(data as Post);
      setActive(0);
      setQuality(0);
      setStatus("ready");
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setError(e instanceof Error ? e.message : "Network error");
      setStatus("error");
    }
  }, []);

  // Auto-preview: fire as soon as the field holds a real post link, so pasting
  // is the whole interaction. Debounced so typing does not spam the backend.
  useEffect(() => {
    const value = link.trim();
    if (!value) {
      lastFetched.current = "";
      setStatus("idle");
      setPost(null);
      setError("");
      return;
    }
    if (!X_LINK.test(value)) return;
    const t = setTimeout(() => void extract(value), 220);
    return () => clearTimeout(t);
  }, [link, extract]);

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (text && X_LINK.test(text)) {
      e.preventDefault();
      setLink(text.trim());
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setLink(text.trim());
    } catch {
      /* clipboard blocked, so they can paste manually */
    }
    inputRef.current?.focus();
  };

  const downloadAll = () => {
    post?.media.forEach((m, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = downloadHref(m);
        a.download = m.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 400);
    });
  };

  const current: Media | undefined = post?.media[active];
  const variants: Variant[] = current?.variants ?? [];
  // Fall back to the item itself when there is nothing to choose between.
  const chosen: Media | Variant = variants[quality] ?? current!;

  return (
    <>
      <Splash />
      <SnowBubbles />
      <GlassX />

      <div className="page">
        <header className="nav">
          <a className="brand" href="/">
            <span className="mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="17" height="17">
                <path d="M4 4l16 16M20 4L4 20" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
              </svg>
            </span>
            <span>X Downloader</span>
          </a>
          <nav className="nav-links">
            <a href="#how">How it works</a>
            <a href="#faq">FAQ</a>
            <a
              className="src"
              href="https://github.com/Krainium/X-Downloader"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg className="src-i" viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
              </svg>
              Source
            </a>
          </nav>
        </header>

        <main>
          <section className="hero">
            <span className="eyebrow">Free · no account</span>
            <h1>Save video and images from X</h1>
            <p className="lede">
              Paste a post link and the preview appears on its own. Download the original file in
              full quality. Nothing is stored on our side.
            </p>

            <div className={`field ${status === "loading" ? "busy" : ""}`}>
              <span className="field-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none">
                  <path d="M10 13a5 5 0 007.5.5l2-2a5 5 0 00-7-7l-1 1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  <path d="M14 11a5 5 0 00-7.5-.5l-2 2a5 5 0 007 7l1-1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </span>
              <input
                ref={inputRef}
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onPaste={onPaste}
                placeholder="https://x.com/user/status/…"
                spellCheck={false}
                autoComplete="off"
                aria-label="X post link"
              />
              {link ? (
                <button className="ghost" onClick={() => setLink("")} aria-label="Clear">✕</button>
              ) : (
                <button className="ghost" onClick={pasteFromClipboard}>Paste</button>
              )}
            </div>

            <p className="assurance">
              {status === "loading" ? "Fetching preview…" : "Public posts only · original quality · nothing saved"}
            </p>
          </section>

          <section className="result" aria-live="polite">
            {status === "error" && <div className="notice error" role="alert">{error}</div>}

            {status === "loading" && !post && (
              <div className="card skeleton">
                <div className="sk-row">
                  <div className="sk-dot" />
                  <div className="sk-lines">
                    <div className="sk-line" />
                    <div className="sk-line short" />
                  </div>
                </div>
                <div className="sk-frame" />
              </div>
            )}

            {post && current && (
              <article className="card">
                <div className="who">
                  {post.avatar && <img className="avatar" src={post.avatar} alt="" loading="lazy" />}
                  <div className="who-text">
                    <strong>{post.author}</strong>
                    <span>@{post.handle}</span>
                  </div>
                  <span className="pill">
                    {post.media.length} {post.media.length === 1 ? "item" : "items"}
                  </span>
                </div>

                {post.text && <p className="tweet-text">{post.text}</p>}

                <div className="stage">
                  {current.type === "photo" ? (
                    <img className="media" src={current.thumb || current.url} alt="" />
                  ) : (
                    <video
                      className="media"
                      src={previewSrc(chosen)}
                      poster={current.thumb}
                      controls
                      playsInline
                      preload="metadata"
                      loop={current.type === "gif"}
                    />
                  )}
                </div>

                {post.media.length > 1 && (
                  <div className="thumbs">
                    {post.media.map((m, i) => (
                      <button
                        key={i}
                        className={`thumb ${i === active ? "on" : ""}`}
                        onClick={() => { setActive(i); setQuality(0); }}
                        aria-label={`Item ${i + 1}`}
                      >
                        <img src={m.thumb || m.url} alt="" loading="lazy" />
                        {m.type !== "photo" && <span className="badge">▶</span>}
                      </button>
                    ))}
                  </div>
                )}

                {variants.length > 1 && (
                  <div className="quality">
                    <span className="quality-label">Quality</span>
                    <div className="quality-opts" role="radiogroup" aria-label="Video quality">
                      {variants.map((v, i) => (
                        <button
                          key={v.url}
                          role="radio"
                          aria-checked={i === quality}
                          className={`q ${i === quality ? "on" : ""}`}
                          onClick={() => setQuality(i)}
                        >
                          <span className="q-res">{v.label}</span>
                          <span className="q-rate">{bitrateLabel(v.bitrate)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="actions">
                  <a className="cta" href={downloadHref(chosen)}>
                    Download {current.type === "photo" ? "image" : current.type === "gif" ? "GIF" : "video"}
                    <span className="meta">
                      {chosen.width > 0 && `${chosen.width}×${chosen.height}`}
                      {chosen.bitrate > 0 && ` · ${bitrateLabel(chosen.bitrate)}`}
                    </span>
                  </a>
                  {post.media.length > 1 && (
                    <button className="cta secondary" onClick={downloadAll}>Download all</button>
                  )}
                </div>
              </article>
            )}
          </section>

          <section id="how" className="band">
            <h2>How it works</h2>
            <div className="steps">
              {STEPS.map((s) => (
                <div className="step" key={s.n}>
                  <span className="step-n">{s.n}</span>
                  <h3>{s.t}</h3>
                  <p>{s.d}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="band">
            <h2>What you get</h2>
            <div className="grid">
              {FEATURES.map((f) => (
                <div className="tile" key={f.t}>
                  <h3>{f.t}</h3>
                  <p>{f.d}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="faq" className="band">
            <h2>Questions</h2>
            <div className="faq">
              {FAQ.map((item, i) => (
                <div className={`qa ${openFaq === i ? "open" : ""}`} key={item.q}>
                  <button onClick={() => setOpenFaq(openFaq === i ? null : i)} aria-expanded={openFaq === i}>
                    <span>{item.q}</span>
                    <span className="chev" aria-hidden="true">⌄</span>
                  </button>
                  <div className="qa-body"><p>{item.a}</p></div>
                </div>
              ))}
            </div>
          </section>
        </main>

        <footer className="foot">
          <p>Not affiliated with X Corp.</p>
        </footer>
      </div>
    </>
  );
}
