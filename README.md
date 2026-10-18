# AnyDrop

AnyDrop is a small, stateless web app that resolves the video(s) in a public
social post, shows the available qualities, and lets you play or download
them — or share a post straight to it from the phone's share sheet.

_Formerly XDrop — renamed once it grew beyond X; the repository and the
original design doc still use the old name._

```text
Paste a link (or share text containing one) / share from an app
    → Resolve public media → Pick a quality (or MP3) → Play / Download
```

**Supported platforms:** X (Twitter), Instagram (Reels, posts, carousels,
IGTV), TikTok, and Facebook (Reels, Watch, page videos, posts, share links).

It's an MVP: no accounts, no database, no queues. See
[`XDrop_MVP_Architecture.md`](./XDrop_MVP_Architecture.md) for the original
design; the note at the top of that document explains the deliberate
deviations from it (Next.js fullstack instead of a separate Express API,
and the later generalization from an X-only "video" domain to a
multi-platform "media" domain).

## Architecture overview

A single Next.js (App Router) app in [`web/`](./web) — frontend and API in
one deployable unit, one origin, no CORS to configure.

```text
web/
├── app/
│   ├── page.tsx              Server Component (forces dynamic rendering
│   │                          for the CSP nonce — see proxy.ts below)
│   ├── HomeClient.tsx         the UI: link input (paste button, platform
│   │                          detection, share-target handling), player,
│   │                          per-video tabs, downloads with progress
│   ├── manifest.ts            PWA manifest, including the share target
│   └── api/
│       ├── media/
│       │   ├── resolve/route.ts   POST — the platform-agnostic API boundary
│       │   └── download/route.ts  GET  — SSRF-checked streaming proxy
│       └── videos/                legacy X-only shape, kept for
│           ├── resolve/route.ts   backward compatibility — see below
│           └── download/route.ts
├── lib/
│   ├── media/
│   │   ├── types.ts           Platform, MediaResolver, ResolvedMedia, MediaItem, MediaVariant
│   │   ├── platforms.ts       host → platform table + link extraction (browser AND server)
│   │   ├── platform-detector.ts   hostname → Platform for the API, no network calls
│   │   ├── resolver-registry.ts   Platform → MediaResolver factory
│   │   ├── service.ts         MediaService — orchestration, cache, retry
│   │   ├── validator.ts       request-body validation (+ link extraction)
│   │   ├── yt-dlp.ts          shared yt-dlp subprocess runner
│   │   ├── ffmpeg.ts          optional ffmpeg detection
│   │   ├── formats.ts         shared format picking: merged + MP3 variants
│   │   ├── assemble.ts        shared final ResolvedMedia assembly
│   │   ├── download.ts        CDN allowlist + streaming proxy
│   │   ├── passthrough.ts     downloads that must re-run yt-dlp (TikTok,
│   │   │                      merged HQ, MP3) — validation + streaming
│   │   ├── errors.ts          AppError + {success,error} JSON responses
│   │   ├── config.ts          shared config (rate limits, timeouts, cache)
│   │   └── x/ instagram/ tiktok/ facebook/   per platform: resolver.ts, validator.ts
│   ├── rate-limit.ts          in-memory per-IP limiter
│   ├── client-api.ts          browser-side fetch helpers (incl. progress downloads)
│   └── recent.ts              client-side "recent lookups" (localStorage)
├── proxy.ts                   per-request CSP nonce (Next 16's Middleware)
├── tests/                     unit/route tests (`npm test`, no network)
├── tests-live/                real-post checks (`npm run test:live`)
└── bin/yt-dlp, yt-dlp_linux   fetched by `npm install`'s postinstall, not committed
```

The app depends only on the `MediaResolver` interface
([`lib/media/types.ts`](./web/lib/media/types.ts)):

```typescript
interface MediaResolver {
  resolve(url: string): Promise<ResolvedMedia>;
}
```

`MediaService.resolveMedia(url)` is the only thing the API routes call. It
doesn't know yt-dlp exists and has no platform-specific logic — it asks
`platform-detector.ts` which platform the URL belongs to (hostname only),
asks `resolver-registry.ts` for that platform's `MediaResolver`, and returns
what it produces. On top of that it adds a short-lived in-memory cache of
successful results (5 minutes by default), in-flight de-duplication (two
simultaneous requests for one link share one yt-dlp run), and one automatic
retry for transient-looking failures (`VIDEO_RESOLUTION_FAILED` only — never
for "not found", "private", or a timeout).

## Getting links in: paste, share text, share sheet

- **Link extraction.** Share sheets and chats hand over text like
  `Check out this video! https://vm.tiktok.com/ZM.../ #fyp`, not a bare URL.
  [`extractMediaUrl`](./web/lib/media/platforms.ts) pulls the first
  supported-platform link out of any text (trimming punctuation glued to
  its end, accepting scheme-less `x.com/...` too). It runs in the browser
  (the input cleans itself up) **and** on the server (`/api/media/resolve`
  accepts the raw text), from one shared host table so the two never
  disagree.
- **Platform detection as you type.** The same table shows "TikTok link",
  "That site isn't supported", etc. under the input instantly, with no
  server round-trip. Pasting a supported link fetches it immediately.
- **Paste button.** Reads the clipboard (`navigator.clipboard.readText`,
  HTTPS or localhost only); normal long-press paste still works where the
  browser doesn't allow it.
- **Share target (Android).** [`manifest.ts`](./web/app/manifest.ts)
  declares a Web Share Target. Once AnyDrop is installed ("Install app"
  button in the page, or the browser's "Add to Home screen"), it appears in
  the share sheet of the TikTok/Instagram/X/Facebook apps. Sharing opens
  `/?title=…&text=…&url=…`; the page searches all three (apps disagree
  about which carries the link), fetches automatically, and clears the
  params from the address bar. Works in Chrome, Edge and Samsung Internet
  on Android. **iOS doesn't support share targets for web apps** — use the
  Shortcut below.

### iPhone: "Send to AnyDrop" Shortcut

The page handles `/?url=<link>` exactly like a share, so an Apple Shortcut
gives iPhone users the same one-tap flow:

1. Open **Shortcuts** → **+** → name it **Send to AnyDrop**.
2. Tap the **ⓘ** (details) → enable **Show in Share Sheet**; set *Receive*
   to **URLs** and **Text**.
3. Add action **URL Encode** (input: *Shortcut Input*).
4. Add action **Text**: `https://<your-anydrop-host>/?url=` followed by the
   *URL Encoded Text* variable.
5. Add action **Open URLs** (input: the Text from step 4).

Then: Share → **Send to AnyDrop** from any app.

## Supported platforms

All four are resolved by shelling out to [**yt-dlp**](https://github.com/yt-dlp/yt-dlp)
(see **How resolution works**); only the interpretation of its output is
platform-specific. Posts with several videos (an X tweet with up to four,
an Instagram carousel) come back as several **items**, shown as tabs.

### X (Twitter)

Accepted: `x.com/<user>/status/<id>`, `twitter.com/...` (and `www.`/`mobile.`),
handle-less `x.com/i/web/status/<id>` and `/i/status/<id>`, and the
`fxtwitter.com`/`vxtwitter.com`/`fixupx.com`/`fixvx.com` embed mirrors
(verified to redirect to the same x.com path) — all normalized to
`https://x.com/<user>/status/<id>`.

- Plain files: X's progressive MP4s (several qualities).
- Multi-video tweets: every video is returned (verified on a real
  two-video tweet; `--no-playlist`, used before, silently kept only the
  first).
- GIFs: served by X as silent MP4s from `/tweet_video/`; marked "no sound"
  and offered without an MP3 option.
- HLS-only videos (no progressive file): served as a merged variant when
  ffmpeg is available — previously a hard failure.

### Instagram

Accepted: `/reel/<id>`, `/reels/<id>`, `/p/<id>`, `/tv/<id>` (each with an
optional `/<username>` prefix), `instagr.am` links, and `/share/...` links
— normalized to `https://www.instagram.com/<reel|p|tv>/<id>/`.
Stories are rejected with a specific message: Instagram only shows them to
logged-in accounts.

Instagram's yt-dlp output has no single format carrying both real
dimensions *and* audio: the progressive (audio+video) file is listed 2–3×
under bare numeric `format_id`s with no width/height, next to DASH
video-only streams (with real dimensions, up to 1080p) and one DASH audio
stream. The progressive file is offered as **"Original"** (no invented
resolution); with ffmpeg, the best DASH video + audio is offered as an
**HQ** merged variant (verified: 1080×1920 VP9 + AAC from a real post whose
progressive file is smaller). Carousels are split into items; carousel
videos Instagram marks as silent are kept and labelled "no sound".

`/share/` links carry an opaque code yt-dlp doesn't accept, so AnyDrop
follows their redirect itself (Instagram hosts only) to the real post URL,
falling back to the page's canonical link. **Caveat:** no real `/share/`
link was available to test this against while it was written; if it can't
find the post, the error tells the user to use "Copy link" instead.

### TikTok

Accepted: `tiktok.com/@<user>/video/<id>`, the `vm.`/`vt.tiktok.com` and
`www.tiktok.com/t/<code>` short links (passed through — yt-dlp follows the
redirect), and legacy `m.tiktok.com/v/<id>.html`, `/share/video/<id>`,
`/embed/<id>` links (rewritten to `/@/video/<id>`, verified to resolve).
Photo slideshows get a specific "not supported" message (yt-dlp's TikTok
extractor only handles videos).

TikTok's video CDN sits behind Akamai bot-management requiring a
JS-challenge cookie only yt-dlp can produce (verified: bare `fetch()` and a
real browser both `403`). So TikTok media is always a **passthrough**
reference (see the download API below) that re-runs yt-dlp at download
time. TikTok must use the standalone yt-dlp build (`yt-dlp_linux`) —
its JS-challenge step was found to fail deterministically via the zipapp.

TikTok also lists its soundtrack as a ready-made MP3, offered as an audio
variant with no ffmpeg needed. Thumbnails are returned again — the cover
image CDN (`p16-common-sign.tiktokcdn.com`) was re-checked and serves
images to a plain fetch, unlike the video CDN.

### Facebook

Accepted: `/reel/<id>`, `/watch/?v=<id>` (and `/watch/live`,
`/video.php?v=`), `/<page>/videos/<id>`, `/<page>/posts/<id>`,
`/groups/<g>/(permalink|posts)/<id>`, `/story.php`/`/permalink.php`, the
`/share/v/`, `/share/r/` share links and `fb.watch/<code>` (both passed
through for yt-dlp to follow), on `www.`/`m.`/`web.`/`mbasic.` hosts.

Facebook's output (verified on real public videos): `hd`/`sd` progressive
files with no codec or dimension metadata, plus DASH video-only streams
and, when the video has sound, a DASH audio stream. `hd`/`sd` are offered
as **HD**/**SD**; whether they carry sound is inferred from the audio
stream's presence (checked both ways with ffprobe). With ffmpeg, the best
DASH video + audio is offered as an HQ merged variant, and MP3 extraction
works. The CDN (`video.*.fbcdn.net`) doesn't check Referer or cookies
(verified), so plain files go through the same proxy as Instagram.

Many Facebook videos are only shown to logged-in users; logged-out
requests for those fail in yt-dlp with "Cannot parse data", which AnyDrop
reports as "not publicly accessible".

## How resolution works

None of the platforms publish a stable public API for post media, so AnyDrop
shells out to yt-dlp — the most actively maintained open-source extractor
covering all four — as a subprocess
([`lib/media/yt-dlp.ts`](./web/lib/media/yt-dlp.ts)):

1. `runYtDlp(url)` spawns the bundled binary with `--dump-json`, **using an
   argument array** (never a shell string), in its own process group, with
   a timeout that sends `SIGTERM` then `SIGKILL`.
2. yt-dlp's extractor returns one JSON object per video (several for
   multi-video posts) describing every available format.
3. Each platform's `normalizeYtDlpOutput` turns that into `ResolvedMedia`.
   Raw yt-dlp fields never reach the API response.
4. Each resolver also drops entries from any *other* site's extractor
   (e.g. a tweet linking a YouTube video), so AnyDrop never resolves — or
   later proxies — third-party media.

### Variant kinds and ffmpeg

Every `MediaVariant` has a `kind`:

| kind | what it is | needs |
|---|---|---|
| `file` | an existing audio+video file, streamed through the proxy as-is (seekable where the CDN supports ranges) | — |
| `merged` | best video-only + best audio-only stream, combined on the fly into fragmented MP4 — the highest quality on Instagram/Facebook, and the only option for HLS-only X videos | ffmpeg |
| `audio` | the soundtrack as MP3 | ffmpeg (except TikTok, which already serves MP3) |

ffmpeg is **optional** ([`lib/media/ffmpeg.ts`](./web/lib/media/ffmpeg.ts)):
`FFMPEG_PATH`, else `web/bin/ffmpeg`, else `ffmpeg` on PATH. Without it,
merged/MP3 variants are simply not offered and everything else works as
before. A merged variant is only offered when it's actually better than
every plain file (higher known resolution). At equal resolution H.264 is
preferred over VP9, because it plays everywhere.

Why fragmented MP4: yt-dlp merging to stdout defaults to MPEG-TS, which
can't carry VP9 — verified, Instagram's 1080p stream came out as an
unplayable data track. AnyDrop passes ffmpeg
`-f mp4 -movflags frag_keyframe+empty_moov+default_base_moof` instead.

### The two bundled yt-dlp binaries

| | `bin/yt-dlp` | `bin/yt-dlp_linux` |
|---|---|---|
| What it is | The Python zipapp (~3MB) | Standalone PyInstaller build (~40MB) |
| Needs `python3` on PATH | Yes | No |
| Startup cost | Fast (~1-2s) | Slower — self-extracts on every run |
| Used for | X/Instagram/Facebook when `python3` exists | TikTok always; everything when there's no `python3` (Vercel) |

Neither is committed. `npm install` inside `web/` fetches them via
`postinstall` ([`web/scripts/fetch-yt-dlp.sh`](./web/scripts/fetch-yt-dlp.sh)),
which now:

- resolves the latest release tag once, then downloads the binaries **and
  verifies each against that release's `SHA2-256SUMS`** — a mismatch aborts
  without replacing the existing binary;
- fetches `yt-dlp_linux_aarch64` (saved as `yt-dlp_linux`) on ARM servers.

`npm run update-resolver` force-refetches the latest release. The running
server picks it up on the next request (every resolve spawns a fresh
process) — no restart needed.

## Installation

Prerequisites: Node.js 20+, `curl`. Optional: `ffmpeg` (for HQ + MP3).

```bash
git clone <this repo>
cd XDrop/web

npm install   # also fetches + verifies the yt-dlp binaries
cp .env.example .env.local   # optional — everything has defaults
```

## Environment variables

All optional — see [`web/.env.example`](./web/.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `YT_DLP_PATH` | *(auto)* | yt-dlp binary — see the table above |
| `YT_DLP_PROXY` | *(none)* | Proxy for every yt-dlp request (`http://…`, `socks5://…`). The platforms throttle datacenter IPs far more than home connections; this is the fix when it works locally but not on a server |
| `FFMPEG_PATH` | *(auto)* | ffmpeg binary — enables HQ merged + MP3 variants |
| `RESOLVER_TIMEOUT_MS` | `30000` | Kills a hung resolve |
| `DOWNLOAD_TIMEOUT_MS` | `45000` | **Inactivity** timeout for streaming downloads — a long video that keeps streaming is never cut off |
| `RESOLVE_CACHE_TTL_MS` | `300000` | Reuse a successful resolve (0 disables). Short because IG/FB CDN URLs are signed and expire |
| `RESOLVE_CACHE_MAX` | `200` | Max cached resolves |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window |
| `RATE_LIMIT_MAX` | `20` | Max `/resolve` requests per window per IP (`/download` allows 2×) |

## Development commands

```bash
cd web
npm run dev          # http://localhost:3000
npm run build        # production build (also type-checks)
npm start            # run the production build
npm test             # unit/route tests — no network, no real yt-dlp
npm run test:live    # real public posts on every platform (slow, needs network)
npm run update-resolver   # fetch the latest yt-dlp (checksum-verified)
```

## API usage

### `POST /api/media/resolve`

```bash
curl -X POST http://localhost:3000/api/media/resolve \
  -H "Content-Type: application/json" \
  -d '{"url":"Check this out https://vm.tiktok.com/ZMabc123/"}'
```

`url` may be a bare link or any text containing one (up to 4000 chars).

Success:

```json
{
  "success": true,
  "data": {
    "platform": "x",
    "sourceUrl": "https://x.com/user/status/123456789",
    "id": "123456789",
    "thumbnail": "https://pbs.twimg.com/...",
    "title": "...",
    "author": { "username": "user", "displayName": "User" },
    "duration": 32,
    "media": [
      { "url": "https://video.twimg.com/...", "quality": "720p", "width": 1280, "height": 720, "bitrate": 1500000, "format": "mp4", "hasAudio": true, "kind": "file" },
      { "url": "https://x.com/user/status/123456789?anydrop_format=hls-audio-128000-Audio&anydrop_audio=mp3", "quality": "Audio", "format": "mp3", "hasAudio": true, "kind": "audio" }
    ],
    "items": [ { "index": 1, "media": [ ... ] }, { "index": 2, "media": [ ... ] } ]
  }
}
```

- `media` is always the first video's variants, sorted best-first —
  single-video consumers can ignore `items`.
- `items` is present only when the post has more than one video.

Failure (`400`/`404`/`502`/`504` depending on `error.code`):

```json
{ "success": false, "error": { "code": "VIDEO_NOT_FOUND", "message": "This post does not contain a video." } }
```

Error codes: `INVALID_URL`, `UNSUPPORTED_URL`, `VIDEO_NOT_FOUND`,
`VIDEO_UNAVAILABLE`, `VIDEO_RESOLUTION_FAILED`, `RESOLVER_TIMEOUT`,
`DOWNLOAD_FAILED`, `RATE_LIMITED`, `INTERNAL_ERROR`. (Named `VIDEO_*` from
when AnyDrop was X-only — kept rather than renamed for the sake of it.)

### `GET /api/media/download`

```text
GET /api/media/download?url=<variant url>&quality=720p&name=<filename base>&mode=inline|attachment
```

`url` is a variant's `url` from a resolve, and is one of two shapes —
anything else is rejected with `UNSUPPORTED_URL`. This is a narrow proxy,
**not** a general URL fetcher:

1. **A CDN file** on an allowlisted host: `twimg.com` (X), `fbcdn.net`
   (Instagram + Facebook), `tiktokcdn.com` (TikTok thumbnails only). Each
   was added after checking real resolver output. Streamed without
   buffering; `Range` is forwarded so the player can seek; redirects are
   followed manually and re-checked against the allowlist on every hop.
2. **A passthrough reference** ([`lib/media/passthrough.ts`](./web/lib/media/passthrough.ts)):
   a post URL plus `anydrop_format` (and optionally `anydrop_item`,
   `anydrop_audio`), e.g.
   `https://www.instagram.com/p/DJQJeVQPnI4/?anydrop_format=dash-…v%2Bdash-…a`.
   Used for TikTok, merged and MP3 variants. Validated strictly: the post
   URL must already be in that platform's canonical form (so it's never
   "any page on tiktok.com"), the selector is one or two format ids
   (`video+audio`) starting with a letter/digit — never a free-form
   yt-dlp expression or anything flag-shaped — the item is 1–20, and
   no other params are allowed. yt-dlp's stdout is piped straight into the
   response with backpressure (a slow client can't make the server buffer
   a whole video), and if the client disconnects, yt-dlp **and** its
   ffmpeg child are killed (verified — killing yt-dlp alone left ffmpeg
   running). No `Content-Length` or seeking for these.

`name` is a suggested filename base (the UI sends e.g.
`tiktok-natgeo-7595589117723954487-720p`); it's reduced to
`[A-Za-z0-9._-]` server-side. `mode=inline` is used by the preview player.

The UI downloads via `fetch` rather than a plain link, which gives a
progress indicator (merged/MP3 downloads take several seconds to start)
and turns a failed download into a readable error instead of a saved JSON
"video". The trade-off: the file is held in memory until complete — fine
for social-media-length videos.

### Legacy: `POST /api/videos/resolve`, `GET /api/videos/download`

Kept, unchanged, for external callers from when AnyDrop was X-only — AnyDrop's
own frontend uses `/api/media/*` (see
[`lib/client-api.ts`](./web/lib/client-api.ts)). `/api/videos/resolve`
calls the same `MediaService` and adapts the result back into the old
`{ videos: [...] }` shape (first video only); `/api/videos/download` is a
re-export of the media download handler. **New code should use
`/api/media/*`.**

## Deploying

### On a VPS (recommended)

A long-running server suits AnyDrop better than serverless: no function time
limit for long merged downloads, a warm cache, and a single process makes
the in-memory rate limiter authoritative.

```bash
sudo apt install -y ffmpeg          # enables HQ + MP3
cd XDrop/web && npm ci && npm run build
PORT=3000 npm start                 # behind nginx/Caddy for HTTPS
```

- HTTPS is required for the share target, install prompt, and Paste button.
- Make the reverse proxy forward the client IP (`X-Forwarded-For`), which
  the rate limiter keys on, and not buffer responses (nginx:
  `proxy_buffering off;`) so long downloads stream.
- Keep yt-dlp current — the platforms change their sites often. A daily
  cron is enough, no restart needed:
  `0 5 * * * cd /path/to/XDrop/web && npm run update-resolver`
- If resolves fail on the server but work locally, it's almost always the
  server's IP being throttled — set `YT_DLP_PROXY`.

### On Vercel

```bash
vercel --cwd web
```

Root directory `web/`; no environment variables required. Specifics:

- `postinstall` fetches `yt-dlp_linux` during the build, and
  [`next.config.ts`](./web/next.config.ts)'s `outputFileTracingIncludes`
  ships it with the functions (Vercel can't see a runtime `spawn()`).
- No ffmpeg there by default, so HQ/MP3 variants aren't offered.
- Routes set `maxDuration = 60`. The Hobby plan's limit may be lower;
  long downloads (and TikTok's re-invoked yt-dlp) can be cut off — a
  reason to self-host.
- The in-memory cache and rate limiter are per instance — best-effort.
- `app/page.tsx` calls `connection()` so the per-request CSP nonce from
  [`proxy.ts`](./web/proxy.ts) matches what's served.

## Monitoring platform breakage

[`.github/workflows/live-check.yml`](./.github/workflows/live-check.yml) runs
`npm run test:live` daily (and on demand) with the newest yt-dlp and
ffmpeg: it resolves one known public post per platform and checks the
first chunk of a real download. A red run usually means updating yt-dlp
on the server, or that a sample post was deleted (swap it in
[`web/tests-live/platforms.live.test.ts`](./web/tests-live/platforms.live.test.ts)).
CI runners use datacenter IPs, so an Instagram-only failure that passes
locally points at IP throttling rather than code.

Unrecognized yt-dlp errors are logged server-side with yt-dlp's stderr
(see `errorResponse` in [`lib/media/errors.ts`](./web/lib/media/errors.ts)),
so new failure modes can be added to each platform's
`classifyResolverFailure`.

## Known limitations

- **Only public content.** AnyDrop doesn't log in and won't bypass private
  accounts, login walls, age gates, or DRM. Content a platform only shows
  to logged-in users (Instagram Stories, many Facebook videos, age-gated
  posts) is reported as `VIDEO_UNAVAILABLE`.
- **TikTok photo slideshows** aren't supported (yt-dlp doesn't extract
  them).
- **Instagram `/share/` links** are handled by following their redirect,
  which couldn't be verified against a real link — see above.
- **Merged/MP3/TikTok downloads have no `Content-Length` or seeking** —
  they're produced on the fly. They also take a few seconds to start.
- **Merged variants may be VP9** when the platform's best stream is VP9
  (H.264 is preferred when available at the same resolution). VP9-in-MP4
  plays in Chrome/Firefox/Android; older iPhones may not play it — pick
  the plain "Original"/"HD" file there.
- **Facebook "HD"/"SD" and Instagram "Original" carry no resolution** in
  yt-dlp's output; AnyDrop doesn't invent one.
- **TikTok shows occasional flakiness** (likely Akamai bot-management).
  The service retries once automatically; a manual retry usually works.
- **Downloads in the UI are buffered in browser memory** until complete
  (for progress + error handling) — fine for social videos, not meant for
  hour-long ones.
- **yt-dlp is an external, frequently-updated dependency** — keep it
  current (see Deploying).
- **No persistence.** No accounts or server-side history; the "Recent"
  list is `localStorage` only.

## Testing

```bash
cd web
npm test           # 170+ unit/route tests, no network
npm run test:live  # real posts on X, Instagram, TikTok, Facebook
```

`npm test` covers: link extraction from share text, platform detection
(including lookalike hosts), every platform's URL normalization (and that
canonical forms are stable), resolver normalization for all four platforms
against fixtures shaped from real yt-dlp output (multi-video tweets, GIFs,
HLS-only videos, Instagram carousels and 1080p merges, Facebook hd/sd and
silent videos, TikTok's MP3), merged/MP3 variant selection, passthrough
validation (rejecting flag-shaped selectors, free-form expressions,
non-canonical URLs, foreign hosts), filename sanitizing, the service's
cache/de-duplication/retry, and every API route. ffmpeg and the cache are
disabled in the test environment so results don't depend on the machine.
