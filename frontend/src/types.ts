export interface Variant {
  url: string;
  label: string;
  width: number;
  height: number;
  bitrate: number;
  filename: string;
}

export interface Media {
  type: "video" | "photo" | "gif";
  url: string;
  thumb: string;
  width: number;
  height: number;
  ext: string;
  bitrate: number;
  filename: string;
  /** Every mp4 rendition, best first. Absent for photos. */
  variants?: Variant[];
}

export interface Post {
  id: string;
  text: string;
  author: string;
  handle: string;
  avatar: string;
  createdAt: string;
  likes: number;
  media: Media[];
}

/**
 * Inline playback url. The video CDN rejects browser requests that do not carry
 * an x.com referer, so previews go through the server rather than straight to
 * the CDN. Images are unaffected and can be loaded directly.
 */
export const previewSrc = (m: Media | Variant): string =>
  `/api/media?url=${encodeURIComponent(m.url)}`;

/** Build a download link for a media item, or for one of its quality variants. */
export const downloadHref = (m: Media | Variant): string =>
  `/api/download?url=${encodeURIComponent(m.url)}&filename=${encodeURIComponent(m.filename)}`;

export function humanSize(bytes: number): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Rough size estimate for a video from its bitrate; X does not report bytes. */
export function bitrateLabel(bitrate: number): string {
  if (!bitrate) return "";
  return `${Math.round(bitrate / 1000)} kbps`;
}
