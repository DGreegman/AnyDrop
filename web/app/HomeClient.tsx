"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  ApiRequestError,
  ResolvedVideo,
  resolveVideo,
  downloadUrl,
  streamUrl,
} from "@/lib/client-api";
import { RecentEntry, loadRecent, addRecent, clearRecent } from "@/lib/recent";

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
  const [video, setVideo] = useState<ResolvedVideo | null>(null);
  const [selectedQuality, setSelectedQuality] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);

  const selectedVariant =
    video?.videos.find((v) => v.quality === selectedQuality) ?? video?.videos[0];

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
    setSelectedQuality(null);

    try {
      const data = await resolveVideo(targetUrl.trim());
      setVideo(data);
      setSelectedQuality(data.videos[0]?.quality ?? null);
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
      <header className="header">
        <h1>XDrop</h1>
        <p className="subtitle">Paste a public X (Twitter) post URL to fetch its video.</p>
      </header>

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
                  <span className="recent-title">{entry.title ?? entry.sourceUrl}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {status === "loading" && (
        <div className="state-box loading" role="status">
          <span className="spinner" aria-hidden="true" />
          Resolving video…
        </div>
      )}

      {status === "error" && (
        <div className="state-box error" role="alert">
          {errorMessage}
        </div>
      )}

      {status === "success" && video && (
        <section className="result">
          {video.title && <h2 className="video-title">{video.title}</h2>}
          <div className="meta">
            {formatDuration(video.duration) && <span>⏱ {formatDuration(video.duration)}</span>}
          </div>

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

          <div className="qualities">
            <h3>Available qualities</h3>
            <ul className="quality-list">
              {video.videos.map((variant) => (
                <li key={variant.quality} className="quality-row">
                  <button
                    type="button"
                    className={
                      variant.quality === selectedQuality ? "quality-btn selected" : "quality-btn"
                    }
                    onClick={() => setSelectedQuality(variant.quality)}
                  >
                    {variant.quality}
                    {variant.width && variant.height ? ` (${variant.width}×${variant.height})` : ""}
                  </button>
                  <a className="download-btn" href={downloadUrl(variant.url, variant.quality)}>
                    Download
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
