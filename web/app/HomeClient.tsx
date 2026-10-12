"use client";

import { ClipboardEvent, FormEvent, useEffect, useRef, useState } from "react";
import {
  ApiRequestError,
  DownloadProgress,
  MediaItem,
  MediaVariant,
  ResolvedMedia,
  resolveVideo,
  downloadUrl,
  downloadWithProgress,
  streamUrl,
} from "@/lib/client-api";
import {
  RecentEntry,
  loadRecent,
  addRecent,
  clearRecent,
  formatRelativeTime,
} from "@/lib/recent";
import { PLATFORM_LABELS, extractMediaUrl, platformForUrl } from "@/lib/media/platforms";

type Status = "idle" | "loading" | "error" | "success";

interface DownloadState {
  progress?: DownloadProgress;
  error?: string;
  done?: boolean;
}

// Chrome/Edge/Samsung Internet fire this when the page is installable;
// not part of TypeScript's DOM lib.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function formatDuration(seconds?: number): string | null {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function itemsOf(video: ResolvedMedia): MediaItem[] {
  return video.items ?? [
    {
      index: 1,
      title: video.title,
      thumbnail: video.thumbnail,
      duration: video.duration,
      media: video.media,
    },
  ];
}

/**
 * The variant to show in the preview player for a selection. Merged and
 * MP3 variants are produced on demand (slower to start, not seekable), so
 * when a plain file exists the preview plays that instead — the
 * selection still decides what Download saves.
 */
function previewVariant(item: MediaItem, selected: MediaVariant | undefined): MediaVariant | undefined {
  if (!selected || selected.kind === undefined || selected.kind === "file") return selected;
  if (selected.kind === "audio") return selected;
  return item.media.find((v) => (v.kind ?? "file") === "file") ?? selected;
}

/** e.g. "tiktok-natgeo-7595589117723954487-720p" — sanitized again server-side. */
function suggestedName(video: ResolvedMedia, item: MediaItem, variant: MediaVariant, multi: boolean): string {
  const who = video.author?.username ?? video.author?.displayName;
  return [
    video.platform,
    who,
    video.id,
    multi ? `${item.index}` : undefined,
    variant.kind === "audio" ? "audio" : variant.quality,
  ]
    .filter(Boolean)
    .join("-");
}

function variantLabel(variant: MediaVariant): string {
  if (variant.kind === "audio") return "Audio only";
  if (variant.quality === "original") return "Original";
  return variant.quality;
}

const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

export default function HomeClient() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [video, setVideo] = useState<ResolvedMedia | null>(null);
  const [itemIndex, setItemIndex] = useState(0);
  // Tracked by url, not the `quality` label string: TikTok can list
  // several distinct encodes at the same resolution (different bitrates),
  // so `quality` ("1024p") isn't always unique across media[] the way it
  // always was for X/Instagram — url always is.
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [canPaste, setCanPaste] = useState(false);
  const loadingRef = useRef(false);

  const items = video ? itemsOf(video) : [];
  const multi = items.length > 1;
  const item = items[itemIndex] ?? items[0];
  const selectedVariant = item?.media.find((v) => v.url === selectedUrl) ?? item?.media[0];
  const preview = item ? previewVariant(item, selectedVariant) : undefined;
  // media[] is sorted best-first by each resolver.
  const bestUrl = item?.media[0]?.url;
  const handle = video?.author?.username;
  const authorLabel = handle ? `@${handle}` : video?.author?.displayName;

  const detectedUrl = extractMediaUrl(url);
  const detectedPlatform = detectedUrl ? platformForUrl(detectedUrl) : undefined;

  async function runResolve(targetUrl: string) {
    const cleaned = extractMediaUrl(targetUrl) ?? targetUrl.trim();
    if (!cleaned || loadingRef.current) return;
    loadingRef.current = true;

    setUrl(cleaned);
    setStatus("loading");
    setErrorMessage(null);
    setVideo(null);
    setItemIndex(0);
    setSelectedUrl(null);
    setDownloads({});

    try {
      const data = await resolveVideo(cleaned);
      setVideo(data);
      setSelectedUrl(data.media[0]?.url ?? null);
      setStatus("success");
      setRecent(addRecent({ sourceUrl: data.sourceUrl, title: data.title, thumbnail: data.thumbnail }));
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Something went wrong. Please try again.";
      setErrorMessage(message);
      setStatus("error");
    } finally {
      loadingRef.current = false;
    }
  }

  useEffect(() => {
    // Deliberately not a lazy useState initializer: this page is
    // server-rendered first (no `window`/localStorage there), then
    // hydrated client-side. Reading localStorage during render would
    // return different results on the server vs. the client and produce a
    // hydration mismatch — reading it here, after mount, avoids that.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecent(loadRecent());
    setCanPaste(typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function");

    // Arriving from the share sheet (manifest.ts share_target) or an
    // iPhone Shortcut: /?url=…, /?text=…, /?title=…. Apps disagree about
    // which field carries the link — many Android apps put it in `text`,
    // wrapped in other words — so all three are searched together.
    const params = new URLSearchParams(window.location.search);
    const shared = ["url", "text", "title"]
      .map((key) => params.get(key))
      .filter(Boolean)
      .join(" ");
    if (shared) {
      // Drop the params so a reload doesn't re-trigger the fetch.
      window.history.replaceState(null, "", window.location.pathname);
      const link = extractMediaUrl(shared);
      if (link) {
        runResolve(link);
      } else {
        setUrl(shared.trim());
        setErrorMessage("No link found in what was shared.");
        setStatus("error");
      }
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
    // Mount-only: re-running this would re-read the share params.
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    runResolve(url);
  }

  // Pasting a supported link (or share text containing one) fetches it
  // straight away — no extra tap on "Fetch Video".
  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    const link = extractMediaUrl(text);
    if (link && platformForUrl(link)) {
      e.preventDefault();
      runResolve(link);
    }
  }

  async function handlePasteButton() {
    try {
      const text = await navigator.clipboard.readText();
      const link = extractMediaUrl(text);
      if (link) {
        runResolve(link);
      } else {
        setUrl(text.trim());
        setErrorMessage("Your clipboard doesn't contain a link.");
        setStatus("error");
      }
    } catch {
      // Permission denied or unsupported — the input still works with a
      // normal long-press paste.
      setErrorMessage("Couldn't read the clipboard — paste into the box instead.");
      setStatus("error");
    }
  }

  async function handleInstall() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice.catch(() => undefined);
    setInstallPrompt(null);
  }

  function handleRecentClick(entry: RecentEntry) {
    runResolve(entry.sourceUrl);
  }

  function handleClearRecent() {
    clearRecent();
    setRecent([]);
  }

  function selectItem(index: number) {
    setItemIndex(index);
    setSelectedUrl(items[index]?.media[0]?.url ?? null);
  }

  async function handleDownload(variant: MediaVariant) {
    if (!video || !item || downloads[variant.url]?.progress) return;
    const href = downloadUrl(variant.url, variant.quality, suggestedName(video, item, variant, multi));
    setDownloads((d) => ({ ...d, [variant.url]: { progress: { received: 0 } } }));
    try {
      await downloadWithProgress(href, (progress) =>
        setDownloads((d) => ({ ...d, [variant.url]: { progress } }))
      );
      setDownloads((d) => ({ ...d, [variant.url]: { done: true } }));
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "The download failed. Please try again.";
      setDownloads((d) => ({ ...d, [variant.url]: { error: message } }));
    }
  }

  function downloadButtonLabel(variant: MediaVariant): string {
    const state = downloads[variant.url];
    if (state?.progress) {
      const { received, total } = state.progress;
      if (received === 0) return variant.kind === "file" || !variant.kind ? "Starting…" : "Preparing…";
      if (total) return `${Math.min(99, Math.floor((received / total) * 100))}%`;
      return formatBytes(received);
    }
    if (state?.done) return "Saved ✓";
    return "Download";
  }

  return (
    <div className="page">
      <div className="hero">
        <div className="wordmark">XDrop</div>
        <h1>Save it. Keep it.</h1>
        <p className="tagline">Download videos from X, Instagram, TikTok and Facebook.</p>
        <p className="supporting">Paste a link to a public post — or share it straight to XDrop.</p>
        {installPrompt && !isStandalone() && (
          <button type="button" className="install-btn" onClick={handleInstall}>
            Install app — then share videos to XDrop
          </button>
        )}
      </div>

      <form className="url-form" onSubmit={handleSubmit}>
        <div className="input-wrap">
          <input
            type="text"
            inputMode="url"
            autoComplete="off"
            placeholder="Paste a video link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onPaste={handlePaste}
            aria-label="Post URL"
            aria-describedby="url-hint"
          />
          {canPaste && !url && (
            <button type="button" className="paste-btn" onClick={handlePasteButton}>
              Paste
            </button>
          )}
        </div>
        <button type="submit" disabled={status === "loading" || !url.trim()}>
          {status === "loading" ? "Fetching…" : "Fetch Video"}
        </button>
      </form>
      <p id="url-hint" className="url-hint" aria-live="polite">
        {url.trim() &&
          (detectedPlatform ? (
            <>
              <span className={`platform-dot platform-${detectedPlatform}`} aria-hidden="true" />
              {PLATFORM_LABELS[detectedPlatform]} link
              {detectedUrl !== url.trim() && " (found in the text)"}
            </>
          ) : detectedUrl ? (
            "That site isn't supported — XDrop works with X, Instagram, TikTok and Facebook."
          ) : (
            "That doesn't look like a link yet."
          ))}
      </p>

      {recent.length > 0 && (
        <div className="recent">
          <div className="recent-header">
            <span>Recent</span>
            <button type="button" className="recent-clear" onClick={handleClearRecent}>
              Clear
            </button>
          </div>
          <ul className="recent-list">
            {recent.map((entry) => (
              <li key={entry.sourceUrl}>
                <button
                  type="button"
                  className="recent-chip"
                  onClick={() => handleRecentClick(entry)}
                  title={entry.sourceUrl}
                >
                  {entry.thumbnail ? (
                    <img src={streamUrl(entry.thumbnail, "thumbnail")} alt="" className="recent-thumb" />
                  ) : (
                    <span className="recent-thumb recent-thumb-empty" aria-hidden="true" />
                  )}
                  <span className="recent-text">
                    <span className="recent-title">{entry.title ?? entry.sourceUrl}</span>
                    <span className="recent-time">{formatRelativeTime(entry.resolvedAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {status === "loading" && (
        <div className="state-box loading" role="status">
          <span className="spinner" aria-hidden="true" />
          {detectedPlatform
            ? `Fetching from ${PLATFORM_LABELS[detectedPlatform]}…`
            : "Finding your video…"}
        </div>
      )}

      {status === "error" && (
        <div className="state-box error" role="alert">
          {errorMessage}
        </div>
      )}

      {status === "success" && video && item && (
        <section className="result">
          <div className="preview">
            {preview?.kind === "audio" ? (
              <div className="audio-preview">
                {item.thumbnail && (
                  <img src={streamUrl(item.thumbnail, "thumbnail")} alt="" className="thumbnail" />
                )}
                <audio key={preview.url} controls src={streamUrl(preview.url, preview.quality)} className="audio-player" />
              </div>
            ) : preview ? (
              <video
                key={preview.url}
                controls
                playsInline
                poster={item.thumbnail ? streamUrl(item.thumbnail, "thumbnail") : undefined}
                src={streamUrl(preview.url, preview.quality)}
                className="player"
              />
            ) : (
              item.thumbnail && (
                <img
                  src={streamUrl(item.thumbnail, "thumbnail")}
                  alt="Video thumbnail"
                  className="thumbnail"
                />
              )
            )}
          </div>

          <div className="result-body">
            {multi && (
              <div className="item-tabs" role="tablist" aria-label="Videos in this post">
                {items.map((it, i) => (
                  <button
                    key={it.index}
                    type="button"
                    role="tab"
                    aria-selected={i === itemIndex}
                    className={i === itemIndex ? "item-tab selected" : "item-tab"}
                    onClick={() => selectItem(i)}
                  >
                    Video {i + 1}
                  </button>
                ))}
              </div>
            )}

            {video.title && <h2 className="video-title">{video.title}</h2>}
            <div className="meta">
              <span className={`platform-pill platform-${video.platform}`}>
                {PLATFORM_LABELS[video.platform]}
              </span>
              {authorLabel && <span>{authorLabel}</span>}
              {formatDuration(item.duration) && <span className="dot">·</span>}
              {formatDuration(item.duration) && <span>{formatDuration(item.duration)}</span>}
            </div>

            <div className="qualities">
              <h3>Available downloads</h3>
              <ul className="quality-list">
                {item.media.map((variant) => {
                  const dl = downloads[variant.url];
                  return (
                    <li
                      key={variant.url}
                      className={variant.url === bestUrl ? "quality-row best" : "quality-row"}
                    >
                      <div className="quality-main">
                        <button
                          type="button"
                          className={variant.url === selectedVariant?.url ? "quality-btn selected" : "quality-btn"}
                          onClick={() => setSelectedUrl(variant.url)}
                        >
                          <span>{variantLabel(variant)}</span>
                          {variant.kind !== "audio" && variant.width && variant.height && (
                            <span className="quality-dims">
                              {variant.width}×{variant.height}
                            </span>
                          )}
                          {variant.kind === "audio" && <span className="quality-dims">MP3</span>}
                          {variant.url === bestUrl && variant.kind !== "audio" && (
                            <span className="best-badge">Best</span>
                          )}
                          {variant.kind === "merged" && <span className="hq-badge">HQ</span>}
                          {variant.kind !== "audio" && !variant.hasAudio && (
                            <span className="quality-dims">no sound</span>
                          )}
                        </button>
                        {dl?.error && <p className="row-error">{dl.error}</p>}
                        {variant.kind === "merged" && dl?.progress?.received === 0 && (
                          <p className="row-note">Combining video and audio — this takes a few seconds to start.</p>
                        )}
                      </div>
                      <button
                        type="button"
                        className="download-btn"
                        onClick={() => handleDownload(variant)}
                        disabled={Boolean(dl?.progress)}
                      >
                        {downloadButtonLabel(variant)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </section>
      )}

      <footer className="tips">
        <p>
          <strong>Tip:</strong> on Android, install XDrop and it appears in the Share menu of the
          TikTok, Instagram, X and Facebook apps. On iPhone, use the “Send to XDrop” Shortcut (see the
          README) for the same thing.
        </p>
        <p>Only public posts can be downloaded.</p>
      </footer>
    </div>
  );
}
