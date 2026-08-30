# XDrop

XDrop is a small, stateless web app that resolves the public video from an
X (formerly Twitter) post URL, shows the available qualities, and lets you
play or download one.

```text
Paste public X post URL → Fetch Video → Resolve public video media
    → Display available qualities → Play / Download
```

It's an MVP: no accounts, no database, no queues. See
[`XDrop_MVP_Architecture.md`](./XDrop_MVP_Architecture.md) for the original
design; the note at the top of that document explains the one deliberate
deviation from it (Next.js fullstack instead of a separate Express API),
made so the whole app deploys as a single Vercel project.

## Architecture overview

A single Next.js (App Router) app in [`web/`](./web) — frontend and API in
one deployable unit, one origin, no CORS to configure.

```text
web/
├── app/
│   ├── page.tsx            Server Component (forces dynamic rendering
│   │                        for the CSP nonce — see proxy.ts below)
│   ├── HomeClient.tsx       the actual UI: URL input, states, player,
│   │                        quality list, download buttons
│   └── api/videos/
│       ├── resolve/route.ts   POST — validate → resolve → normalize
│       └── download/route.ts  GET  — SSRF-checked streaming proxy
├── lib/
│   ├── videos/
│   │   ├── types.ts         VideoResolver interface, ResolvedVideo
│   │   ├── resolver.ts       XVideoResolver (wraps yt-dlp)
│   │   ├── service.ts        VideoService — orchestration
│   │   ├── validator.ts      URL validation
│   │   ├── download.ts       media-URL SSRF allowlist + streaming
│   │   ├── errors.ts         AppError + {success,error} JSON responses
│   │   └── config.ts
│   ├── rate-limit.ts         in-memory per-IP limiter
│   └── client-api.ts         browser-side fetch helpers
├── proxy.ts                  per-request CSP nonce (Next 16's Middleware)
├── app/manifest.ts, RegisterSW.tsx, public/sw.js   PWA — installable, no offline caching of video
└── bin/yt-dlp, yt-dlp_linux    fetched by scripts/setup-resolver.sh, not committed
```

The app depends only on the `VideoResolver` interface
([`lib/videos/types.ts`](./web/lib/videos/types.ts)):

```typescript
interface VideoResolver {
  resolve(url: string): Promise<ResolvedVideo>;
}
```

`XVideoResolver` ([`lib/videos/resolver.ts`](./web/lib/videos/resolver.ts))
is the only piece that knows yt-dlp exists. Everything above it — service,
route handlers, frontend — only ever sees `ResolvedVideo` / `VideoVariant`.
Swapping the resolver implementation later means writing a new class that
implements `VideoResolver`; nothing else changes.

## How the resolver works

X does not publish a stable public API for post media, so XDrop shells out
to [**yt-dlp**](https://github.com/yt-dlp/yt-dlp) — the most actively
maintained open-source extractor for X/Twitter video — as a subprocess:

1. `XVideoResolver.resolve(url)` spawns a bundled yt-dlp binary with
   `--dump-json` **using an argument array**
   (`spawn(path, [url, ...flags])`), never a shell string built from user
   input.
2. yt-dlp's `twitter` extractor resolves the post and returns raw JSON
   describing every available format (HLS variants, audio-only tracks,
   progressive MP4s, storyboards, etc).
3. `normalizeYtDlpOutput` filters that down to the **progressive MP4/WebM**
   formats (the ones playable/downloadable as a single file, no HLS player
   or client-side muxing needed), dedupes by resolution keeping the
   highest-bitrate variant per quality, and maps them onto the app's
   `VideoVariant` shape. Raw yt-dlp fields never reach the API response.
4. If yt-dlp resolves a link to a *different* site embedded in the tweet
   (e.g. a tweet that just links a YouTube video), the resolver rejects it —
   XDrop only serves video actually hosted on X's own CDN.

There are actually **two** bundled binaries, picked automatically at
startup (`lib/videos/config.ts`), because they trade off differently:

| | `bin/yt-dlp` | `bin/yt-dlp_linux` |
|---|---|---|
| What it is | The regular Python zipapp (~3MB) | yt-dlp's standalone, self-contained PyInstaller build (~40MB) |
| Needs `python3` on PATH | Yes | No |
| Startup cost | Fast (~1-2s) — runs directly | Slower — self-extracts to a fresh temp dir on **every** invocation |
| Used when | `python3` is on PATH (local dev, most self-hosted deploys) | `python3` isn't available (Vercel serverless functions aren't guaranteed to have it) |

Neither is committed to the repo; run `scripts/setup-resolver.sh` once to
fetch both into `web/bin/`.

An earlier version of this app used only the standalone binary everywhere,
which turned out to be a real problem locally: repeated timeouts (from
genuine network slowness) were `SIGKILL`ing that binary before it could
clean up its self-extracted temp directory, leaking ~80MB per timeout and,
under any disk pressure, making every subsequent extraction slower —
compounding into more timeouts. Fixed two ways: prefer the fast zipapp
whenever `python3` is available, and send `SIGTERM` (with a grace period)
instead of `SIGKILL` on timeout so the standalone binary gets a chance to
clean up when it *is* the one in use.

## Installation

Prerequisites: Node.js 20+, `curl`.

```bash
git clone <this repo>
cd XDrop

./scripts/setup-resolver.sh   # fetches both binaries into web/bin/

cd web
npm install
cp .env.example .env.local
```

## Environment variables

**`web/.env.local`** (all optional — sensible defaults if unset; see
`.env.example`)

| Variable | Default | Purpose |
|---|---|---|
| `YT_DLP_PATH` | *(auto)* | Path to the yt-dlp binary. Defaults to `./bin/yt-dlp` if `python3` is on PATH, else `./bin/yt-dlp_linux`, else `yt-dlp` on PATH |
| `RESOLVER_TIMEOUT_MS` | `30000` | Kills the yt-dlp subprocess if it hangs. 30s, not 20s, deliberately — real-world network/DNS variance can eat 10-20s even on a warm process |
| `DOWNLOAD_TIMEOUT_MS` | `45000` | Timeout for the upstream media fetch when streaming/downloading |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window |
| `RATE_LIMIT_MAX` | `20` | Max `/resolve` requests per window per IP (`/download` allows 2×) |

## Development commands

```bash
cd web
npm run dev      # http://localhost:3000 (or next free port)
npm run build    # production build (also type-checks)
npm start         # run the production build locally
npm test          # vitest suite
```

Open the printed URL, paste a public X post URL that contains a video,
click **Fetch Video**.

## API usage

### `POST /api/videos/resolve`

```bash
curl -X POST http://localhost:3000/api/videos/resolve \
  -H "Content-Type: application/json" \
  -d '{"url":"https://x.com/user/status/123456789"}'
```

Accepts `x.com` and `twitter.com` status URLs. Success:

```json
{
  "success": true,
  "data": {
    "sourceUrl": "https://x.com/user/status/123456789",
    "thumbnail": "https://pbs.twimg.com/...",
    "title": "...",
    "duration": 32,
    "videos": [
      { "quality": "720p", "width": 1280, "height": 720, "bitrate": 1500000, "format": "mp4", "url": "https://video.twimg.com/..." },
      { "quality": "480p", "width": 854,  "height": 480, "bitrate": 900000,  "format": "mp4", "url": "https://video.twimg.com/..." }
    ]
  }
}
```

Failure (`400`/`404`/`502`/`504` depending on `error.code`):

```json
{ "success": false, "error": { "code": "VIDEO_NOT_FOUND", "message": "This post does not contain a video." } }
```

Error codes: `INVALID_URL`, `UNSUPPORTED_URL`, `VIDEO_NOT_FOUND`,
`VIDEO_UNAVAILABLE`, `VIDEO_RESOLUTION_FAILED`, `RESOLVER_TIMEOUT`,
`DOWNLOAD_FAILED`, `RATE_LIMITED`, `INTERNAL_ERROR`.

### `GET /api/videos/download`

Streams a previously-resolved media URL back to the browser without
buffering it fully in memory, forwarding `Range` requests so the player can
seek.

```text
GET /api/videos/download?url=<video.twimg.com media URL>&quality=720p&mode=inline|attachment
```

- `url` **must** be an `https://` URL on `twimg.com` or a subdomain of it —
  anything else is rejected with `UNSUPPORTED_URL`. This is a narrow,
  allowlisted proxy for X's own CDN, **not** a general URL fetcher.
- `mode=attachment` (default) sets `Content-Disposition: attachment` to
  force a save-as download; `mode=inline` is used by the `<video>` preview
  player.

This endpoint exists because `video.twimg.com` enforces a
referrer/hotlink check that rejects a browser loading it directly from a
third-party page — see **Known limitations** below.

## Deploying to Vercel

```bash
./scripts/setup-resolver.sh   # make sure web/bin/yt-dlp_linux exists locally (it's the one Vercel uses)
vercel --cwd web
```

Set the root directory to `web/` in the Vercel project settings (or pass
`--cwd web` as above). No environment variables are required to deploy —
all of them have working defaults.

A few things specific to running this on Vercel's serverless platform,
since it's a meaningfully different environment from a normal persistent
Node server:

- **The resolver binary ships with the function bundle.** Vercel's build
  can't see a runtime `spawn(binaryPath)` call, so
  [`next.config.ts`](./web/next.config.ts)'s `outputFileTracingIncludes`
  explicitly declares `web/bin/**` for both API routes to make sure
  `yt-dlp_linux` is actually included in the deployed function.
- **No `python3` dependency.** `yt-dlp_linux` is yt-dlp's standalone,
  self-contained build — verified to resolve a real video with `PATH`
  cleared entirely. A Vercel Node function isn't guaranteed to have
  `python3` on PATH, so the regular `yt-dlp` (a Python zipapp) would be a
  much less reliable choice here.
- **Function duration limits.** Both routes set
  `export const maxDuration = 60` (App Router route segment config) —
  resolving typically takes 3-6s once a function instance is warm — but
  the *first* invocation on a cold instance is measurably slower (yt-dlp's
  standalone binary self-extracts on each process spawn; that cost is
  paid once per warm container, not per request). Vercel's Hobby plan
  enforces a 10s ceiling regardless of what a route asks for; Pro and
  above respect the 60s, which comfortably covers a cold start. If you hit
  `RESOLVER_TIMEOUT` or truncated downloads on Hobby, that's this limit,
  not a bug — either upgrade the plan or self-host (`npm run build && npm
  start` behind any Node host) where there's no such ceiling.
- **In-memory rate limiting resets per cold start** and isn't shared
  across concurrent instances — a best-effort backstop on serverless, not
  a hard guarantee (see [`lib/rate-limit.ts`](./web/lib/rate-limit.ts)).
- **CSP nonces require dynamic rendering.** [`proxy.ts`](./web/proxy.ts)
  (Next 16's renamed Middleware) issues a fresh CSP nonce per request;
  `app/page.tsx` calls `connection()` to force per-request rendering so
  that nonce actually matches what gets served — without it, the page
  would be statically prerendered once at build time with a stale nonce,
  and the CSP would silently block the app's own scripts in production.

## Known limitations

- **Only public content.** XDrop does not, and will not, attempt to bypass
  private accounts, login walls, age gates, or DRM. If yt-dlp can't resolve
  a post without authenticating, XDrop reports `VIDEO_UNAVAILABLE`.
- **Playback/download always go through the backend proxy, not directly to
  `video.twimg.com`.** X's CDN enforces a referrer check that a third-party
  page fails, so both the `<video>` preview and the Download button use
  `GET /api/videos/download` (Strategy B from the architecture doc) rather
  than linking straight to the resolved media URL (Strategy A).
- **yt-dlp is an external, frequently-updated dependency.** If X changes
  something and the bundled yt-dlp release falls behind, resolution can
  start failing until it's updated (`./scripts/setup-resolver.sh` again) —
  this is exactly why the `VideoResolver` interface exists.
- **No persistence.** Nothing is stored; every request re-resolves from
  scratch. There's no download history, caching, or retry queue.
- **Vercel Hobby's 10s function timeout** can be tight for a slow
  resolution or a larger video download — see **Deploying to Vercel**.
- **Resolution time depends on real network conditions to X**, same as the
  old yt-dlp CLI always did — a slow/congested connection can push a
  resolve well past the "typical" few seconds. The app doesn't fetch any
  other external resource at request time (no Google Fonts, no third-party
  APIs), specifically so a resolve is the only thing that can be slow.
- Quality labels are derived from video height (e.g. `720p`); XDrop does
  not transcode or re-encode — it only re-serves what X already generated.

## Testing

```bash
cd web
npm test
```

Covers URL validation (valid/invalid/unsupported), resolver-response
normalization and error classification (pure functions, no real yt-dlp
process invoked), `VideoService` orchestration, the shared error-response
mapping, and the `/api/videos/*` route handlers (success, validation
errors, resolver failures, and the download SSRF allowlist) called
directly with a constructed `NextRequest` and a mocked resolver — no
network calls or running server in the test suite.
