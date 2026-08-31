# XDrop

XDrop is a small, stateless web app that resolves the public video from a
social post URL, shows the available qualities, and lets you play or
download one.

```text
Paste public post URL → Fetch Video → Resolve public video media
    → Display available qualities → Play / Download
```

**Supported platforms today:** X (Twitter), Instagram Reels, and TikTok.
**Recognized but not yet supported:** Facebook — pasting a Facebook link
gives a clear "not supported yet" error rather than a generic failure;
there's no resolver behind it yet.

It's an MVP: no accounts, no database, no queues. See
[`XDrop_MVP_Architecture.md`](./XDrop_MVP_Architecture.md) for the original
design; the note at the top of that document explains the deliberate
deviations from it (Next.js fullstack instead of a separate Express API,
and the later generalization from an X-only "video" domain to a
multi-platform "media" domain), made so the whole app stays a single
Vercel project while growing to more platforms.

## Architecture overview

A single Next.js (App Router) app in [`web/`](./web) — frontend and API in
one deployable unit, one origin, no CORS to configure.

```text
web/
├── app/
│   ├── page.tsx              Server Component (forces dynamic rendering
│   │                          for the CSP nonce — see proxy.ts below)
│   ├── HomeClient.tsx         the actual UI: URL input, states, player,
│   │                          quality list, download buttons
│   └── api/
│       ├── media/
│       │   ├── resolve/route.ts   POST — the platform-agnostic API boundary
│       │   └── download/route.ts  GET  — SSRF-checked streaming proxy
│       └── videos/                legacy X-only shape, kept for
│           ├── resolve/route.ts   backward compatibility — see below
│           └── download/route.ts
├── lib/
│   ├── media/
│   │   ├── types.ts           Platform, MediaResolver, ResolvedMedia, MediaVariant
│   │   ├── platform-detector.ts   hostname → Platform, no network calls
│   │   ├── resolver-registry.ts   Platform → MediaResolver factory
│   │   ├── service.ts         MediaService — the orchestration the API calls
│   │   ├── validator.ts       generic request-body validation
│   │   ├── download.ts        media-URL SSRF allowlist + streaming (all platforms)
│   │   ├── errors.ts          AppError + {success,error} JSON responses
│   │   ├── config.ts          shared config (rate limits, download timeout)
│   │   ├── yt-dlp.ts          shared yt-dlp subprocess runner (X/Instagram/TikTok)
│   │   ├── x/                 X-specific: resolver.ts, validator.ts
│   │   ├── instagram/         Instagram-specific: resolver.ts, validator.ts
│   │   └── tiktok/            TikTok-specific: resolver.ts, validator.ts,
│   │                          download.ts (see below — TikTok's download
│   │                          step re-invokes yt-dlp, unlike the others)
│   ├── rate-limit.ts          in-memory per-IP limiter
│   ├── client-api.ts          browser-side fetch helpers
│   └── recent.ts              client-side "recent lookups" (localStorage)
├── proxy.ts                   per-request CSP nonce (Next 16's Middleware)
├── app/manifest.ts, RegisterSW.tsx, public/sw.js   PWA — installable, no offline caching of video
└── bin/yt-dlp, yt-dlp_linux    fetched by `npm install`'s postinstall, not committed
```

The app depends only on the `MediaResolver` interface
([`lib/media/types.ts`](./web/lib/media/types.ts)):

```typescript
interface MediaResolver {
  resolve(url: string): Promise<ResolvedMedia>;
}
```

`MediaService.resolveMedia(url)` is the only thing the API routes call. It
doesn't know yt-dlp exists, and it doesn't contain any platform-specific
logic — it just: validates the URL is well-formed, asks
`platform-detector.ts` which platform it belongs to (hostname only, no
network request), asks `resolver-registry.ts` for that platform's
`MediaResolver`, and returns whatever that resolver produces. Adding a
platform means writing one new `<platform>/resolver.ts` implementing
`MediaResolver` and adding one line to the registry — nothing else in the
app changes.

## Supported platforms

### X (Twitter)

`XVideoResolver` ([`lib/media/x/resolver.ts`](./web/lib/media/x/resolver.ts))
shells out to yt-dlp's `twitter` extractor. See **How resolution works**
below for the mechanism — it's shared with Instagram.

Accepted URL shapes: `x.com/<user>/status/<id>`,
`twitter.com/<user>/status/<id>` (and `www.`/`mobile.` host variants),
normalized to a canonical `https://x.com/<user>/status/<id>` before
resolving.

### Instagram (Reels only)

`InstagramResolver`
([`lib/media/instagram/resolver.ts`](./web/lib/media/instagram/resolver.ts))
shells out to yt-dlp's `Instagram` extractor. Only Reels are supported —
regular posts (`/p/...`) and IGTV (`/tv/...`) aren't handled yet.

Accepted URL shapes: `instagram.com/reel/<id>`,
`instagram.com/<username>/reel/<id>` (and `www.` variant), normalized to
`https://www.instagram.com/reel/<id>/`.

Instagram's yt-dlp output looks nothing like X's, which is why it has its
own normalization logic rather than sharing X's: a real Reel's
`--dump-json` (checked against several public Reels before writing any
code, not assumed) has no single format carrying both real
width/height/bitrate *and* audio. Instead there's a small set of
*duplicate* entries — the same URL repeated under different bare-numeric
`format_id`s — that together represent one playable, audio-carrying
progressive file with no dimension metadata attached, alongside separate
DASH video-only and audio-only streams that *do* carry real dimensions.
XDrop only ever serves single-file, directly-fetchable media (the same
constraint X's resolver operates under), so it dedupes those progressive
duplicates down to one variant and reports its quality as `"original"`
rather than inventing a resolution number by borrowing it from an
unrelated DASH stream. `author.username`/`author.displayName` come
straight from yt-dlp's own `channel`/`uploader` fields (Instagram's
extractor — unlike X's — reliably exposes these); `author.avatar` is
never populated because yt-dlp doesn't expose one. `duration` is also
typically absent — verified `null` across every real Reel checked while
building this.

### TikTok

`TikTokResolver` ([`lib/media/tiktok/resolver.ts`](./web/lib/media/tiktok/resolver.ts))
shells out to yt-dlp's `TikTok` extractor.

Accepted URL shapes: `tiktok.com/@<user>/video/<id>`,
`www.tiktok.com/@<user>/video/<id>`, and the `vm.tiktok.com`/`vt.tiktok.com`
share-link short domains (verified against two real, live short links —
yt-dlp follows the redirect and resolves the real video internally, so
XDrop doesn't pre-resolve it itself). Long-form URLs normalize to
`https://www.tiktok.com/@<user>/video/<id>`.

TikTok is the one platform where **resolving is not enough to also
download**. Its progressive (video+audio) formats *do* carry real
width/height/bitrate (verified against several real videos — unlike
Instagram, no metadata gap here), but the CDN URL yt-dlp reports sits
behind Akamai bot-management requiring a JS-challenge-solved cookie.
Verified empirically: a bare `fetch()` and a full real-browser navigation
to that exact URL both come back `403`, correct Referer/User-Agent
included — they only succeed when yt-dlp handles the *entire* request
itself (a captured-cookie-reuse shortcut was also tried and found
unreliable: worked once, failed on immediate retry). So instead of the raw
CDN URL, each `media[].url` XDrop returns is the *source* TikTok page URL
plus an `xdrop_format` query param — [`lib/media/tiktok/download.ts`](./web/lib/media/tiktok/download.ts)
recognizes that exact shape and re-invokes yt-dlp at download time,
streaming its stdout (`-o -`) straight into the HTTP response rather than
proxying a link that would just 403. See **`GET /api/media/download`**
below for what this costs (no `Content-Length`/Range support for TikTok
specifically).

`author.username`/`author.displayName` come from yt-dlp's `uploader`/
`channel` fields — note this is the **opposite** mapping from Instagram's
extractor, where `channel` is the username and `uploader` the display
name. `duration` is reliably real (unlike Instagram). No `thumbnail`:
TikTok's thumbnail CDN sits behind the same Akamai protection as the
video CDN, and re-invoking yt-dlp a second time just for a still image
wasn't worth the extra latency for an MVP.

### Not yet supported: Facebook

`platform-detector.ts` already recognizes its hostnames (so pasting a
Facebook link gives a specific, honest "not supported yet" error instead
of a generic "couldn't resolve this"), but there's no resolver registered
for it — `resolver-registry.ts` throws a clear `UNSUPPORTED_URL` on
purpose, rather than a fake/stub resolver that would silently do nothing
useful.

## How resolution works

None of X, Instagram, or TikTok publish a stable public API for post
media, so XDrop shells out to [**yt-dlp**](https://github.com/yt-dlp/yt-dlp)
— the most actively maintained open-source extractor covering all three —
as a subprocess. This part is shared across every yt-dlp-backed resolver
([`lib/media/yt-dlp.ts`](./web/lib/media/yt-dlp.ts)); only the
interpretation of the result is platform-specific:

1. `runYtDlp(url)` spawns a bundled yt-dlp binary with `--dump-json`
   **using an argument array** (`spawn(path, [url, ...flags])`), never a
   shell string built from user input, with a timeout that sends
   `SIGTERM` (then `SIGKILL` after a grace period) if yt-dlp hangs.
2. yt-dlp's platform-specific extractor (`twitter`, `Instagram`, or
   `TikTok`) resolves the post and returns raw JSON describing every
   available format (HLS/DASH variants, audio-only tracks, progressive
   files, storyboards, etc).
3. Each platform's own `normalizeYtDlpOutput` (in `x/resolver.ts` /
   `instagram/resolver.ts` / `tiktok/resolver.ts`) filters that down to
   directly-fetchable, audio-carrying variants and maps them onto the
   app's generic `ResolvedMedia`/`MediaVariant` shape. Raw yt-dlp fields
   never reach the API response.
4. Each resolver also rejects output that didn't actually come from its
   own platform's extractor — e.g. a tweet that just links a YouTube video
   gets rejected by `XVideoResolver` rather than silently resolving
   YouTube content instead.

There are actually **two** bundled binaries, picked automatically at
startup (`lib/media/yt-dlp.ts`), because they trade off differently:

| | `bin/yt-dlp` | `bin/yt-dlp_linux` |
|---|---|---|
| What it is | The regular Python zipapp (~3MB) | yt-dlp's standalone, self-contained PyInstaller build (~40MB) |
| Needs `python3` on PATH | Yes | No |
| Startup cost | Fast (~1-2s) — runs directly | Slower — self-extracts to a fresh temp dir on **every** invocation |
| Used when | `python3` is on PATH (local dev, most self-hosted deploys) | `python3` isn't available (Vercel serverless functions aren't guaranteed to have it) |

Neither is committed to the repo (they're 3-40MB binaries, not source) —
`npm install` inside `web/` fetches them automatically via a `postinstall`
script ([`web/scripts/fetch-yt-dlp.sh`](./web/scripts/fetch-yt-dlp.sh)).
**This matters for deployment, not just local dev**: it's what actually
gets `yt-dlp_linux` into a Vercel build. A deploy built straight from this
git repo has no `web/bin/` at all — without the `postinstall` fetch, the
resolver falls through to a bare `yt-dlp` on PATH, which doesn't exist on
Vercel, and every resolve fails with `VIDEO_RESOLUTION_FAILED` ("The video
resolver is unavailable"). `scripts/setup-resolver.sh` at the repo root is
only for explicitly force-refetching later (e.g. to pick up a yt-dlp
update) — you don't need to run it up front.

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
cd XDrop/web

npm install   # also fetches the yt-dlp binaries — see above
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

Open the printed URL, paste a public X, Instagram Reel, or TikTok video
URL, click **Fetch Video**.

## API usage

### `POST /api/media/resolve`

The primary, platform-agnostic endpoint. Works for any supported
platform — the request shape never changes; the response's `platform`
field tells you which resolver handled it.

```bash
curl -X POST http://localhost:3000/api/media/resolve \
  -H "Content-Type: application/json" \
  -d '{"url":"https://x.com/user/status/123456789"}'

curl -X POST http://localhost:3000/api/media/resolve \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.instagram.com/reel/abc123/"}'

curl -X POST http://localhost:3000/api/media/resolve \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.tiktok.com/@user/video/123456789"}'
```

Success:

```json
{
  "success": true,
  "data": {
    "platform": "x",
    "sourceUrl": "https://x.com/user/status/123456789",
    "thumbnail": "https://pbs.twimg.com/...",
    "title": "...",
    "author": { "username": "user" },
    "duration": 32,
    "media": [
      { "url": "https://video.twimg.com/...", "quality": "720p", "width": 1280, "height": 720, "bitrate": 1500000, "format": "mp4", "hasAudio": true },
      { "url": "https://video.twimg.com/...", "quality": "480p", "width": 854,  "height": 480, "bitrate": 900000,  "format": "mp4", "hasAudio": true }
    ]
  }
}
```

Failure (`400`/`404`/`502`/`504` depending on `error.code`):

```json
{ "success": false, "error": { "code": "VIDEO_NOT_FOUND", "message": "This post does not contain a video." } }
```

A Facebook URL (recognized, not yet implemented) or a genuinely
unrecognized domain both come back as `400 UNSUPPORTED_URL`, with a
message telling you which case it was.

Error codes: `INVALID_URL`, `UNSUPPORTED_URL`, `VIDEO_NOT_FOUND`,
`VIDEO_UNAVAILABLE`, `VIDEO_RESOLUTION_FAILED`, `RESOLVER_TIMEOUT`,
`DOWNLOAD_FAILED`, `RATE_LIMITED`, `INTERNAL_ERROR`. (Named `VIDEO_*` from
when XDrop was X-only — kept as-is rather than renamed for the sake of it;
they're still accurate, specific failure conditions regardless of which
platform a resolver is for.)

### `GET /api/media/download`

Streams a previously-resolved media URL back to the browser without
buffering it fully in memory, forwarding `Range` requests so the player can
seek (X and Instagram only — see the TikTok note below).

```text
GET /api/media/download?url=<CDN media URL>&quality=720p&mode=inline|attachment
```

- `url` **must** be an `https://` URL on an allowlisted CDN host —
  currently `twimg.com` (X) or `fbcdn.net` (Instagram), each added only
  after checking it against real resolver output, not guessed. Anything
  else is rejected with `UNSUPPORTED_URL`. This is a narrow, allowlisted
  proxy for known CDNs, **not** a general URL fetcher.
- The `Referer` sent upstream is chosen per-host to match (X's CDN
  enforces a referrer/hotlink check; Instagram's didn't in testing, but a
  matching one is sent anyway as the more correct default).
- `mode=attachment` (default) sets `Content-Disposition: attachment` to
  force a save-as download; `mode=inline` is used by the `<video>` preview
  player.

This endpoint exists because these CDNs reject a browser loading them
directly from a third-party page (X's is a hard requirement; see **Known
limitations**) — see architecture doc §7, Strategy B.

**TikTok is a different shape entirely.** Its `url` isn't a CDN file link
at all — it's the validated TikTok video page plus an `xdrop_format` query
param (`https://www.tiktok.com/@user/video/123?xdrop_format=h264_720p-1`).
`isTikTokPassthroughUrl()` accepts that exact shape *only* (re-validated
through the same regex the resolver itself uses, plus a strict charset
check on the format id) — this is not "any tiktok.com URL is a valid media
reference," and never proxies an arbitrary tiktok.com path.
`buildTikTokMediaResponse()` re-invokes yt-dlp against that page URL with
`-f <format_id> -o -`, piping its stdout straight into the response (see
**TikTok** above for why: the raw CDN URL 403s without a
challenge-solved cookie only yt-dlp can produce). One consequence: there's
no `Content-Length` or Range/seek support for TikTok specifically — yt-dlp
doesn't expose the upstream size before it starts streaming, and there's
no clean way to ask it for a byte range. The file still downloads/plays
fine over chunked transfer; a `<video>` element just can't seek ahead of
what's already buffered.

### Legacy: `POST /api/videos/resolve`, `GET /api/videos/download`

Kept working, unchanged, for backward compatibility from when XDrop was
X-only — the current frontend still calls these. `/api/videos/resolve`
calls the exact same `MediaService` as `/api/media/resolve` and adapts the
result back into the old `{ videos: [...] }` shape (no `platform`,
`author`, or `hasAudio` fields); `/api/videos/download` is a direct
re-export of the media download handler, since download was already
platform-agnostic in shape. **New code should use `/api/media/*`
instead** — the legacy routes exist only so nothing that already depends
on the old contract breaks.

## Deploying to Vercel

```bash
vercel --cwd web
```

Set the root directory to `web/` in the Vercel project settings (or pass
`--cwd web` as above). No environment variables are required to deploy —
all of them have working defaults.

A few things specific to running this on Vercel's serverless platform,
since it's a meaningfully different environment from a normal persistent
Node server:

- **The resolver binary has to actually reach the deployed function**,
  which takes two separate steps, both already wired up: `npm install`'s
  `postinstall` fetches `yt-dlp_linux` into `web/bin/` during Vercel's
  build (it isn't committed to git — see **How resolution works**
  above), and [`next.config.ts`](./web/next.config.ts)'s
  `outputFileTracingIncludes` then makes sure that file is actually
  included in the deployed function bundle for every route that resolves
  media, since Vercel's build can't see a runtime `spawn(binaryPath)` call
  on its own. Skip either step and every resolve fails with
  `VIDEO_RESOLUTION_FAILED`.
- **No `python3` dependency.** `yt-dlp_linux` is yt-dlp's standalone,
  self-contained build — verified to resolve real X and Instagram content
  with `PATH` cleared entirely. A Vercel Node function isn't guaranteed to
  have `python3` on PATH, so the regular `yt-dlp` (a Python zipapp) would
  be a much less reliable choice here.
- **Function duration limits.** All four routes set
  `export const maxDuration = 60` (App Router route segment config) —
  resolving typically takes a few seconds once a function instance is
  warm — but the *first* invocation on a cold instance is measurably
  slower (yt-dlp's standalone binary self-extracts on each process spawn;
  that cost is paid once per warm container, not per request). Vercel's
  Hobby plan enforces a 10s ceiling regardless of what a route asks for;
  Pro and above respect the 60s, which comfortably covers a cold start. If
  you hit `RESOLVER_TIMEOUT` or truncated downloads on Hobby, that's this
  limit, not a bug — either upgrade the plan or self-host (`npm run build
  && npm start` behind any Node host) where there's no such ceiling.
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

- **Only public content, on every platform.** XDrop does not, and will
  not, attempt to bypass private accounts, login walls, age gates, or DRM.
  If yt-dlp can't resolve a post without authenticating, XDrop reports
  `VIDEO_UNAVAILABLE`. For Instagram specifically, yt-dlp can't actually
  distinguish "this post doesn't exist" from "this post exists but
  requires login" — both produce the same "empty media response" from
  Instagram's side — so both map to the same honest `VIDEO_UNAVAILABLE`
  rather than guessing which one it is.
- **Instagram support is Reels only.** Regular posts (`/p/...`) and IGTV
  (`/tv/...`) are rejected as unsupported, not attempted.
- **Facebook is recognized, not resolvable.** Pasting a Facebook link
  gives a specific "not supported yet" error rather than a generic
  failure — there's no resolver registered for it yet.
- **Instagram media quality is reported as `"original"`, not a resolution
  number.** Unlike X and TikTok, Instagram's yt-dlp output doesn't attach
  real width/height to the one progressive (audio+video) file it actually
  serves — see **Supported platforms** above for why. XDrop doesn't invent
  a resolution by borrowing one from an unrelated stream.
- **TikTok specifically requires the standalone yt-dlp binary, never the
  zipapp — this is enforced in code, not just a preference.** Both X and
  Instagram work fine with either bundled binary, but TikTok's extractor
  runs a "Solving JS challenge using native Python implementation" step,
  and that step was found, reproduced, and confirmed *deterministically* —
  same machine, same video, tested back-to-back, repeatedly — to fail via
  the zipapp (which shells out to whatever `python3` happens to be on
  PATH) while succeeding reliably via the standalone build (which bundles
  its own Python). `ytDlpStandalonePath` in
  [`lib/media/yt-dlp.ts`](./web/lib/media/yt-dlp.ts) is what TikTok's
  resolver and download path use instead of the auto-selected default —
  don't change that without re-testing against real TikTok content.
- **TikTok still shows more occasional flakiness than X or Instagram even
  with the correct binary** — a real single-video resolve/preview/download
  sequence run in quick succession sometimes has one step fail even though
  an isolated retry of that same step succeeds immediately after. Akamai's
  bot-management is the most likely cause, but this wasn't narrowed down
  further. Worth a retry if a TikTok request fails; not something the app
  can fully paper over.
- **TikTok downloads have no `Content-Length` or Range/seek support** —
  see **`GET /api/media/download`** above for why (yt-dlp re-invocation,
  not a CDN fetch, for that platform specifically).
- **TikTok never returns a `thumbnail`** — its thumbnail CDN sits behind
  the same Akamai protection as the video CDN.
- **Playback/download always go through the backend proxy, not directly to
  the CDN.** X's CDN enforces a referrer check that a third-party page
  fails, and TikTok's requires a challenge-solved cookie a browser can
  never provide on its own, so both the `<video>` preview and the Download
  button use `GET /api/media/download` (Strategy B from the architecture
  doc) rather than linking straight to the resolved media URL
  (Strategy A). Applied uniformly to Instagram too, for consistency, even
  though its CDN didn't strictly require it in testing.
- **yt-dlp is an external, frequently-updated dependency.** If a platform
  changes something and the bundled yt-dlp release falls behind,
  resolution for that platform can start failing until it's updated
  (`./scripts/setup-resolver.sh` again) — this is exactly why the
  `MediaResolver` interface exists.
- **No persistence.** Nothing is stored server-side; every request
  re-resolves from scratch. There's no download history, caching, or
  retry queue. (The frontend does keep a small "recent lookups" list, but
  that's `localStorage` only — see [`lib/recent.ts`](./web/lib/recent.ts).)
- **Vercel Hobby's 10s function timeout** can be tight for a slow
  resolution or a larger media download — see **Deploying to Vercel**.
- **Resolution time depends on real network conditions to the target
  platform**, same as the yt-dlp CLI always had. The app doesn't fetch any
  other external resource at request time (no Google Fonts, no
  third-party APIs), specifically so a resolve is the only thing that can
  be slow.
- The frontend is still X-branded ("XDrop") and its URL input/placeholder
  copy is still X-specific — it now reads `author.username` generically
  (works for any platform, not an X-only heuristic) but hasn't had a
  multi-platform visual/copy pass yet; that's deliberately out of scope
  until more platforms land.

## Testing

```bash
cd web
npm test
```

Covers URL validation (valid/invalid/unsupported, generic and per-platform,
including TikTok's `vm.`/`vt.` short links), platform detection (all 4
recognized platforms + hostname-spoofing attempts + malformed URLs), the
resolver registry (X, Instagram, and TikTok resolve to real resolvers;
Facebook fails cleanly), `MediaService` orchestration (including
dispatching a TikTok short link), resolver-response normalization for X,
Instagram, and TikTok (pure functions, no real yt-dlp process invoked in
the test suite), TikTok's `xdrop_format` passthrough-URL validation, the
shared error-response mapping, and every `/api/media/*` and legacy
`/api/videos/*` route handler (success, validation errors, resolver
failures, and the download SSRF allowlist — including checks that
Instagram's CDN host and a well-formed TikTok passthrough URL are
accepted, and that an unsafe/missing `xdrop_format` is rejected) — called
directly with a constructed `NextRequest` and a mocked resolver where
appropriate, no network calls required for most of the suite. Real
yt-dlp resolution and download against live public X, Instagram, and
TikTok content is verified manually (see git history / PR notes), not in
CI.
