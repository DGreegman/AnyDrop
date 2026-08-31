"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  ApiRequestError,
  ResolvedMedia,
  resolveVideo,
  downloadUrl,
  streamUrl,
} from "@/lib/client-api";
import {
  RecentEntry,
  loadRecent,
  addRecent,
  clearRecent,
  formatRelativeTime,
} from "@/lib/recent";

type Status = "idle" | "loading" | "error" | "success";

function formatDuration(seconds?: number): string | null {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

export default function HomeClient() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [video, setVideo] = useState<ResolvedMedia | null>(null);
  // Tracked by url, not the `quality` label string: TikTok can list
  // several distinct encodes at the same resolution (different bitrates),
  // so `quality` ("1024p") isn't always unique across media[] the way it
  // always was for X/Instagram — url always is.
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);

  const selectedVariant = video?.media.find((v) => v.url === selectedUrl) ?? video?.media[0];
  // media[] is sorted highest-first by each resolver — the first entry is
  // always the best available quality.
  const bestUrl = video?.media[0]?.url;
  const handle = video?.author?.username;

  useEffect(() => {
    // Deliberately not a lazy useState initializer: this page is
    // server-rendered first (no `window`/localStorage there), then
    // hydrated client-side. Reading localStorage during render would
    // return different results on the server vs. the client and produce a
    // hydration mismatch — reading it here, after mount, avoids that.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecent(loadRecent());
  }, []);

  async function runResolve(targetUrl: string) {
    if (!targetUrl.trim() || status === "loading") return;

    setStatus("loading");
    setErrorMessage(null);
    setVideo(null);
    setSelectedUrl(null);

    try {
      const data = await resolveVideo(targetUrl.trim());
      setVideo(data);
      setSelectedUrl(data.media[0]?.url ?? null);
      setStatus("success");
      setRecent(addRecent({ sourceUrl: data.sourceUrl, title: data.title, thumbnail: data.thumbnail }));
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Something went wrong. Please try again.";
      setErrorMessage(message);
      setStatus("error");
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    runResolve(url);
  }

  function handleRecentClick(entry: RecentEntry) {
    setUrl(entry.sourceUrl);
    runResolve(entry.sourceUrl);
  }

  function handleClearRecent() {
    clearRecent();
    setRecent([]);
  }

  return (
    <div className="page">
      <div className="hero">
        <div className="wordmark">XDrop</div>
        <h1>Save it. Keep it.</h1>
        <p className="tagline">Download videos from X in seconds.</p>
        <p className="supporting">Paste a public X post URL to get started.</p>
      </div>

      <form className="url-form" onSubmit={handleSubmit}>
        <input
          type="text"
          inputMode="url"
          placeholder="https://x.com/user/status/123456789"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="X post URL"
        />
        <button type="submit" disabled={status === "loading" || !url.trim()}>
          {status === "loading" ? "Fetching…" : "Fetch Video"}
        </button>
      </form>

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
          Finding your video…
        </div>
      )}

      {status === "error" && (
        <div className="state-box error" role="alert">
          {errorMessage}
        </div>
      )}

      {status === "success" && video && (
        <section className="result">
          <div className="preview">
            {selectedVariant ? (
              <video
                key={selectedVariant.url}
                controls
                poster={video.thumbnail ? streamUrl(video.thumbnail, "thumbnail") : undefined}
                src={streamUrl(selectedVariant.url, selectedVariant.quality)}
                className="player"
              />
            ) : (
              video.thumbnail && (
                <img
                  src={streamUrl(video.thumbnail, "thumbnail")}
                  alt="Video thumbnail"
                  className="thumbnail"
                />
              )
            )}
          </div>

          <div className="result-body">
            {video.title && <h2 className="video-title">{video.title}</h2>}
            <div className="meta">
              {handle && <span>@{handle}</span>}
              {handle && formatDuration(video.duration) && <span className="dot">·</span>}
              {formatDuration(video.duration) && <span>{formatDuration(video.duration)}</span>}
            </div>

            <div className="qualities">
              <h3>Available qualities</h3>
              <ul className="quality-list">
                {video.media.map((variant) => (
                  <li
                    key={variant.url}
                    className={variant.url === bestUrl ? "quality-row best" : "quality-row"}
                  >
                    <button
                      type="button"
                      className={variant.url === selectedUrl ? "quality-btn selected" : "quality-btn"}
                      onClick={() => setSelectedUrl(variant.url)}
                    >
                      <span>{variant.quality}</span>
                      {variant.width && variant.height && (
                        <span className="quality-dims">
                          {variant.width}×{variant.height}
                        </span>
                      )}
                      {variant.url === bestUrl && <span className="best-badge">Best</span>}
                    </button>
                    <a className="download-btn" href={downloadUrl(variant.url, variant.quality)}>
                      Download
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
