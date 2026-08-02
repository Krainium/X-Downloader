// X video and image downloader.
//
// Extraction goes through X's public syndication endpoint (the one the embed
// widget uses), which returns tweet JSON including media variants without an
// API key. Downloads are streamed back through this server so the browser gets
// a proper filename and never talks to X's CDN directly.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	syndicationBase = "https://cdn.syndication.twimg.com/tweet-result"
	browserUA       = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
		"(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

var tweetID = regexp.MustCompile(`(?:status(?:es)?)/(\d{10,25})`)

// Rendition size as it appears in a video CDN path, for example /1280x720/.
var sizeInPath = regexp.MustCompile(`/([0-9]{2,4})x([0-9]{2,4})/`)

// ─── wire types ──────────────────────────────────────────────────────────────

type Media struct {
	Type     string `json:"type"`     // video | photo | gif
	URL      string `json:"url"`      // direct CDN url, the best rendition
	Thumb    string `json:"thumb"`    // poster/preview
	Width    int    `json:"width"`    // 0 when unknown
	Height   int    `json:"height"`   //
	Ext      string `json:"ext"`      // mp4 | jpg | png
	Bitrate  int    `json:"bitrate"`  // video only
	Filename string `json:"filename"` // suggested save name
	// Every mp4 rendition, best first, so the caller can offer a quality choice.
	// Empty for photos.
	Variants []Variant `json:"variants,omitempty"`
}

// Variant is one selectable video quality.
type Variant struct {
	URL      string `json:"url"`
	Label    string `json:"label"`   // 720p, or a bitrate when the size is unknown
	Width    int    `json:"width"`   // 0 when the url carries no size
	Height   int    `json:"height"`  //
	Bitrate  int    `json:"bitrate"` //
	Filename string `json:"filename"`
}

type Post struct {
	ID        string  `json:"id"`
	Text      string  `json:"text"`
	Author    string  `json:"author"`
	Handle    string  `json:"handle"`
	Avatar    string  `json:"avatar"`
	CreatedAt string  `json:"createdAt"`
	Likes     int     `json:"likes"`
	Media     []Media `json:"media"`
}

// Shape of the syndication response, narrowed to what we use.
type syndicationTweet struct {
	IDStr     string `json:"id_str"`
	Text      string `json:"text"`
	CreatedAt string `json:"created_at"`
	Favorites int    `json:"favorite_count"`
	User      struct {
		Name       string `json:"name"`
		ScreenName string `json:"screen_name"`
		Avatar     string `json:"profile_image_url_https"`
	} `json:"user"`
	MediaDetails []struct {
		Type          string `json:"type"` // photo | video | animated_gif
		MediaURLHTTPS string `json:"media_url_https"`
		OriginalInfo  struct {
			Width  int `json:"width"`
			Height int `json:"height"`
		} `json:"original_info"`
		VideoInfo struct {
			Variants []struct {
				Bitrate     int    `json:"bitrate"`
				ContentType string `json:"content_type"`
				URL         string `json:"url"`
			} `json:"variants"`
		} `json:"video_info"`
	} `json:"mediaDetails"`
	Tombstone *struct {
		Text struct {
			Text string `json:"text"`
		} `json:"text"`
	} `json:"tombstone"`
}

// ─── http client ─────────────────────────────────────────────────────────────

// client honours XDL_PROXY so the whole thing can leave through a VLESS exit
// when X starts refusing the host's own IP. Unset means direct.
func newClient() *http.Client {
	tr := &http.Transport{
		MaxIdleConns:        64,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 15 * time.Second,
	}
	if p := os.Getenv("XDL_PROXY"); p != "" {
		if u, err := url.Parse(p); err == nil {
			tr.Proxy = http.ProxyURL(u)
			log.Printf("upstream proxy: %s", u.Redacted())
		} else {
			log.Printf("XDL_PROXY is not a valid url, ignoring: %v", err)
		}
	}
	return &http.Client{Transport: tr, Timeout: 60 * time.Second}
}

var client = newClient()

// ─── extraction ──────────────────────────────────────────────────────────────

func parseTweetID(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("no link given")
	}
	if m := tweetID.FindStringSubmatch(raw); m != nil {
		return m[1], nil
	}
	// Bare id pasted on its own.
	if _, err := strconv.ParseUint(raw, 10, 64); err == nil {
		return raw, nil
	}
	return "", errors.New("that does not look like an X post link")
}

// The endpoint requires a token parameter but does not verify it, so this is
// just a deterministic non-empty value rather than a reimplementation of the
// widget's float to base36 trick.
func tokenFor(id string) string {
	n, err := strconv.ParseUint(id, 10, 64)
	if err != nil {
		return "1a2b3c"
	}
	return strconv.FormatUint(n%1e11, 36)
}

func pickExt(contentType, fallback string) string {
	switch {
	case strings.Contains(contentType, "mp4"):
		return "mp4"
	case strings.Contains(contentType, "png"):
		return "png"
	case strings.Contains(contentType, "webp"):
		return "webp"
	case strings.Contains(contentType, "jpeg"), strings.Contains(contentType, "jpg"):
		return "jpg"
	}
	return fallback
}

// orZero returns a when it is non zero, otherwise b.
func orZero(a, b int) int {
	if a != 0 {
		return a
	}
	return b
}

func safeName(s string) string {
	s = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`\/:*?"<>|`, r) || r < 32 {
			return '_'
		}
		return r
	}, s)
	if len(s) > 60 {
		s = s[:60]
	}
	return strings.TrimSpace(s)
}

func extract(rawURL string) (*Post, error) {
	id, err := parseTweetID(rawURL)
	if err != nil {
		return nil, err
	}

	q := url.Values{}
	q.Set("id", id)
	q.Set("token", tokenFor(id))
	q.Set("lang", "en")
	req, _ := http.NewRequest("GET", syndicationBase+"?"+q.Encode(), nil)
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Referer", "https://platform.twitter.com/")

	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("could not reach X: %w", err)
	}
	defer res.Body.Close()

	switch res.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return nil, errors.New("post not found. It may be deleted, private, or age restricted")
	default:
		return nil, fmt.Errorf("X returned %d", res.StatusCode)
	}

	var t syndicationTweet
	if err := json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(&t); err != nil {
		return nil, fmt.Errorf("unreadable response from X: %w", err)
	}
	if t.Tombstone != nil {
		return nil, errors.New("this post is not publicly viewable")
	}

	post := &Post{
		ID:        id,
		Text:      t.Text,
		Author:    t.User.Name,
		Handle:    t.User.ScreenName,
		Avatar:    t.User.Avatar,
		CreatedAt: t.CreatedAt,
		Likes:     t.Favorites,
		Media:     []Media{},
	}

	base := safeName(t.User.ScreenName + "_" + id)
	for i, md := range t.MediaDetails {
		switch md.Type {
		case "video", "animated_gif":
			// Keep every mp4 rendition, best first, so the caller can pick a quality.
			vs := md.VideoInfo.Variants
			sort.Slice(vs, func(a, b int) bool { return vs[a].Bitrate > vs[b].Bitrate })

			kind := "video"
			if md.Type == "animated_gif" {
				kind = "gif"
			}

			var variants []Variant
			for _, v := range vs {
				if !strings.Contains(v.ContentType, "mp4") {
					continue
				}
				w, h := 0, 0
				if m := sizeInPath.FindStringSubmatch(v.URL); m != nil {
					w, _ = strconv.Atoi(m[1])
					h, _ = strconv.Atoi(m[2])
				}
				// Quality follows the short side, not the height. A vertical
				// 1080x1920 clip is 1080p, and labelling it by height would
				// call it 1920p.
				label := fmt.Sprintf("%d kbps", v.Bitrate/1000)
				if w > 0 && h > 0 {
					short := h
					if w < h {
						short = w
					}
					label = fmt.Sprintf("%dp", short)
				}
				variants = append(variants, Variant{
					URL:      v.URL,
					Label:    label,
					Width:    w,
					Height:   h,
					Bitrate:  v.Bitrate,
					Filename: fmt.Sprintf("%s_%d_%s.mp4", base, i+1, label),
				})
			}
			if len(variants) > 0 {
				best := variants[0]
				post.Media = append(post.Media, Media{
					Type:     kind,
					URL:      best.URL,
					Thumb:    md.MediaURLHTTPS,
					Width:    orZero(best.Width, md.OriginalInfo.Width),
					Height:   orZero(best.Height, md.OriginalInfo.Height),
					Ext:      "mp4",
					Bitrate:  best.Bitrate,
					Filename: fmt.Sprintf("%s_%d.mp4", base, i+1),
					Variants: variants,
				})
			}
		case "photo":
			// ?name=orig gives the original at full resolution.
			full := md.MediaURLHTTPS
			ext := pickExt("", strings.TrimPrefix(filepath.Ext(full), "."))
			if ext == "" {
				ext = "jpg"
			}
			if !strings.Contains(full, "?") {
				full += "?name=orig"
			}
			post.Media = append(post.Media, Media{
				Type:     "photo",
				URL:      full,
				Thumb:    md.MediaURLHTTPS + "?name=small",
				Width:    md.OriginalInfo.Width,
				Height:   md.OriginalInfo.Height,
				Ext:      ext,
				Filename: fmt.Sprintf("%s_%d.%s", base, i+1, ext),
			})
		}
	}

	if len(post.Media) == 0 {
		return nil, errors.New("this post has no downloadable video or image")
	}
	return post, nil
}

// ─── handlers ────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, map[string]any{
		"ok":      true,
		"proxied": os.Getenv("XDL_PROXY") != "",
		"time":    time.Now().UTC().Format(time.RFC3339),
	})
}

func handleExtract(w http.ResponseWriter, r *http.Request) {
	link := r.URL.Query().Get("url")
	if link == "" && r.Method == http.MethodPost {
		var body struct {
			URL string `json:"url"`
		}
		_ = json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body)
		link = body.URL
	}
	post, err := extract(link)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, post)
}

// Only X's own media hosts may be streamed, so this cannot be used as an open
// proxy for arbitrary URLs.
func allowedMediaHost(h string) bool {
	h = strings.ToLower(h)
	for _, suffix := range []string{".twimg.com", "twimg.com"} {
		if strings.HasSuffix(h, suffix) {
			return true
		}
	}
	return false
}

func handleDownload(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("url")
	name := r.URL.Query().Get("filename")
	if target == "" {
		writeJSON(w, 400, map[string]string{"error": "url is required"})
		return
	}
	u, err := url.Parse(target)
	if err != nil || !allowedMediaHost(u.Hostname()) {
		writeJSON(w, 403, map[string]string{"error": "only X media hosts are allowed"})
		return
	}
	if name == "" {
		name = "x-download"
	}

	req, _ := http.NewRequest("GET", target, nil)
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Referer", "https://x.com/")
	req.Header.Set("Accept", "*/*")

	res, err := client.Do(req)
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": "could not fetch media: " + err.Error()})
		return
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		writeJSON(w, res.StatusCode, map[string]string{"error": fmt.Sprintf("media host returned %d", res.StatusCode)})
		return
	}

	if ct := res.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	if cl := res.Header.Get("Content-Length"); cl != "" {
		w.Header().Set("Content-Length", cl)
	}
	// RFC 5987 so non-ASCII names survive.
	w.Header().Set("Content-Disposition",
		fmt.Sprintf("attachment; filename*=UTF-8''%s", url.PathEscape(safeName(name))))
	w.Header().Set("Cache-Control", "no-store")
	_, _ = io.Copy(w, res.Body)
}

// ─── static frontend ─────────────────────────────────────────────────────────

func staticHandler(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := filepath.Join(dir, filepath.Clean(r.URL.Path))
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			fs.ServeHTTP(w, r)
			return
		}
		// SPA fallback.
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	})
}

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
		}
	})
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "4444"
	}
	dist := os.Getenv("XDL_DIST")
	if dist == "" {
		dist = "./public"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", handleHealth)
	mux.HandleFunc("/api/extract", handleExtract)
	mux.HandleFunc("/api/download", handleDownload)
	mux.Handle("/", staticHandler(dist))

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           withLogging(mux),
		ReadHeaderTimeout: 15 * time.Second,
	}
	log.Printf("x-downloader listening on :%s (serving %s)", port, dist)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
