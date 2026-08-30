# XDrop — MVP Architecture

> **Implementation note:** the shipped app follows this document's
> component boundaries, API contract, resolver abstraction, and security
> requirements as written, with one deliberate deviation: it's implemented
> as a single Next.js (App Router) fullstack app in `web/` — route handlers
> instead of a separate Express server — rather than the split
> frontend/backend shown below, so the whole thing deploys to Vercel as one
> project. This was an explicit request, made after the original Express +
> Vite split was built and confirmed working. See the root
> [`README.md`](./README.md) for the as-built structure and deployment
> notes.

## 1. Project Overview

**XDrop** is a small web application that allows users to paste a public X (formerly Twitter) post URL containing a video, resolve the publicly accessible video media, choose an available quality, and download or play the video.

The MVP is intentionally simple and stateless.

### Primary goal

> Paste an X URL → resolve the video → choose quality → download.

The first version should prioritize a working end-to-end flow over production-scale infrastructure or visual polish.

---

## 2. Architecture

XDrop uses a **modular monolith** architecture.

```text
                    ┌──────────────────────┐
                    │       Frontend       │
                    │                      │
                    │  URL input           │
                    │  Video preview       │
                    │  Quality selection   │
                    │  Download button     │
                    └──────────┬───────────┘
                               │
                               │ HTTP
                               ▼
                    ┌──────────────────────┐
                    │      Express API     │
                    │                      │
                    │  URL validation      │
                    │  Controllers         │
                    │  Error handling      │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │     Video Service    │
                    │                      │
                    │  Business logic      │
                    │  Response mapping    │
                    │  Resolver orchestration│
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │   Resolver Adapter   │
                    │                      │
                    │ Existing downloader/ │
                    │ resolver library     │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │   Public X Media     │
                    │      Delivery        │
                    └──────────────────────┘
```

---

## 3. Architectural Principles

### Keep the MVP small

Do not introduce infrastructure that does not solve an immediate problem.

The MVP does **not** require:

- Microservices
- Load balancers
- Redis
- PostgreSQL/MongoDB
- Message queues
- Background workers
- Kubernetes
- Authentication
- User accounts
- Complex cloud infrastructure

The application should remain a **stateless modular monolith**.

### Separate responsibilities

The HTTP layer should not know how X video resolution works.

The resolver should not know anything about HTTP responses.

The service layer should coordinate the process and normalize external data.

This separation makes the resolver replaceable.

---

# 4. Backend Components

## API Layer

Responsible for:

- Receiving HTTP requests
- Validating request input
- Calling the video service
- Returning normalized responses
- Mapping errors to HTTP responses

Example:

```text
POST /api/videos/resolve
```

---

## Video Service

Responsible for application-level video logic.

Responsibilities:

- Accept a validated X URL
- Call the resolver
- Normalize resolver output
- Select/organize available video variants
- Return application-level data

The service should not depend on the implementation details of a specific resolver library.

---

## Resolver Adapter

This is the most important architectural boundary in the MVP.

Create an abstraction such as:

```typescript
interface VideoResolver {
  resolve(url: string): Promise<ResolvedVideo>;
}
```

Then implement the X-specific resolver:

```typescript
class XVideoResolver implements VideoResolver {
  async resolve(url: string): Promise<ResolvedVideo> {
    // Existing downloader/resolver implementation
  }
}
```

### Why?

External downloaders/resolvers can stop working when X changes its systems.

With the adapter architecture:

```text
VideoService
     │
     ▼
VideoResolver interface
     │
     ▼
XVideoResolver
     │
     ▼
External resolver
```

The rest of the application does not need to change if the underlying resolver is replaced.

---

# 5. Suggested Backend Structure

```text
src/
├── app.ts
├── server.ts
│
├── config/
│   └── env.ts
│
├── modules/
│   └── videos/
│       ├── video.routes.ts
│       ├── video.controller.ts
│       ├── video.service.ts
│       ├── video.resolver.ts
│       ├── video.types.ts
│       └── video.validator.ts
│
├── middleware/
│   └── error-handler.ts
│
└── utils/
```

The exact structure may change slightly during implementation, but responsibilities should remain separated.

---

# 6. API Contract

## Resolve Video

### Endpoint

```http
POST /api/videos/resolve
```

### Request

```json
{
  "url": "https://x.com/user/status/123456789"
}
```

Also support:

```text
https://twitter.com/user/status/123456789
```

### Validation

The API should reject:

- Missing URLs
- Malformed URLs
- Arbitrary URLs
- Unsupported domains
- URLs that are not X/Twitter status URLs

Return:

```http
400 Bad Request
```

for validation errors.

---

## Successful Response

```json
{
  "success": true,
  "data": {
    "sourceUrl": "https://x.com/user/status/123456789",
    "thumbnail": "https://...",
    "title": "...",
    "duration": 32,
    "videos": [
      {
        "quality": "360p",
        "width": 640,
        "height": 360,
        "bitrate": 500000,
        "format": "mp4",
        "url": "https://..."
      },
      {
        "quality": "720p",
        "width": 1280,
        "height": 720,
        "bitrate": 1500000,
        "format": "mp4",
        "url": "https://..."
      }
    ]
  }
}
```

The API should expose a **normalized application-level response**, not the raw response from the external resolver.

---

# 7. Download Flow

There are two possible download strategies.

## Strategy A — Direct Download

If the resolved media URL works correctly from the browser, the frontend can use the media URL directly.

```text
Frontend
   │
   └──► Resolved media URL
              │
              ▼
          X Media CDN
```

This is the preferred MVP approach because it reduces server bandwidth and implementation complexity.

---

## Strategy B — Backend Streaming

If browser CORS, Content-Disposition, or cross-origin restrictions make direct downloads unreliable, provide:

```http
GET /api/videos/download
```

The backend should:

1. Receive the selected media reference.
2. Validate it.
3. Request the media.
4. Stream it to the client.
5. Avoid buffering the entire video in memory.

Example:

```text
Browser
   │
   │ GET /api/videos/download
   ▼
Express
   │
   │ streaming request
   ▼
Video CDN
   │
   │ video stream
   ▼
Express
   │
   │ video stream
   ▼
Browser
```

Set appropriate headers:

```http
Content-Type: video/mp4
Content-Disposition: attachment; filename="x-video.mp4"
```

Do **not** create an unrestricted arbitrary URL proxy.

---

# 8. Frontend Architecture

The frontend only needs a few states.

```text
                ┌───────────────┐
                │  Enter URL    │
                └───────┬───────┘
                        │
                        ▼
                ┌───────────────┐
                │ Fetch Video   │
                └───────┬───────┘
                        │
                   Loading
                        │
                        ▼
                ┌───────────────┐
                │ Video Result  │
                │               │
                │ Thumbnail     │
                │ Title         │
                │ Duration      │
                │               │
                │ 720p Download │
                │ 480p Download │
                │ 360p Download │
                └───────────────┘
```

### Required UI

- URL input
- Fetch button
- Loading state
- Error state
- Thumbnail
- Video preview if practical
- Available qualities
- Download buttons

Keep the UI intentionally simple.

---

# 9. End-to-End Request Flow

```text
User
 │
 │ Paste X post URL
 ▼
Frontend
 │
 │ POST /api/videos/resolve
 ▼
Express API
 │
 │ Validate URL
 ▼
Video Controller
 │
 ▼
Video Service
 │
 │ resolve(url)
 ▼
VideoResolver
 │
 ▼
XVideoResolver
 │
 ▼
Existing Downloader/Resolver
 │
 ▼
Public X Media
 │
 ▼
XVideoResolver
 │
 │ Normalize
 ▼
Video Service
 │
 ▼
Controller
 │
 │ JSON response
 ▼
Frontend
 │
 │ Display qualities
 ▼
User
 │
 │ Select quality
 ▼
Direct media URL
 OR
/api/videos/download
 │
 ▼
Downloaded video
```

---

# 10. Security Boundaries

Even though this is a small project, the following boundaries should exist from day one.

### URL validation

Only accept supported X/Twitter status URLs.

### No arbitrary proxying

Never allow:

```text
/api/videos/download?url=https://any-site.com/internal-resource
```

without validating the target.

Otherwise the endpoint can become an SSRF vulnerability.

### No arbitrary command execution

If the resolver uses a command-line downloader, never construct shell commands using raw user input.

Prefer argument arrays:

```typescript
spawn(command, [validatedUrl, ...args])
```

rather than:

```typescript
exec(`downloader ${userProvidedUrl}`)
```

### Request limits

Use:

- Request body limits
- Rate limiting
- Timeouts

### Error handling

Never expose:

- Stack traces
- Internal filesystem paths
- Resolver internals
- Environment variables
- Sensitive error details

---

# 11. Error Model

Use a consistent API response.

### Error

```json
{
  "success": false,
  "error": {
    "code": "VIDEO_RESOLUTION_FAILED",
    "message": "Unable to resolve video from this post."
  }
}
```

Useful error codes:

```text
INVALID_URL
UNSUPPORTED_URL
VIDEO_NOT_FOUND
VIDEO_UNAVAILABLE
VIDEO_RESOLUTION_FAILED
RESOLVER_TIMEOUT
DOWNLOAD_FAILED
INTERNAL_ERROR
```

---

# 12. MVP Data Model

No database is required.

The application can operate entirely in memory.

The main domain object is:

```typescript
interface ResolvedVideo {
  sourceUrl: string;
  thumbnail?: string;
  title?: string;
  duration?: number;
  videos: VideoVariant[];
}

interface VideoVariant {
  quality: string;
  width?: number;
  height?: number;
  bitrate?: number;
  format: string;
  url: string;
}
```

---

# 13. Technology Choices

## Backend

```text
Node.js
TypeScript
Express
Zod
Helmet
CORS
Rate limiter
```

## Resolver

Use an existing maintained downloader/resolver solution rather than implementing X media extraction from scratch for the MVP.

The resolver must remain behind the `VideoResolver` abstraction.

## Frontend

Use the simplest frontend stack that gets the application working quickly.

Possible options:

```text
React + Vite
```

or

```text
Next.js
```

Do not introduce unnecessary frontend architecture.

---

# 14. Development Priorities

The implementation should follow this order:

### Priority 1 — Prove resolution works

```text
X URL
  ↓
Resolver
  ↓
Actual video metadata
```

This is the highest-risk part of the project.

### Priority 2 — API

```text
POST /api/videos/resolve
```

Return normalized video data.

### Priority 3 — Frontend

Connect the UI to the API.

### Priority 4 — Download

Make at least one quality downloadable/playable.

### Priority 5 — Hardening

Add:

- Error handling
- Rate limiting
- Timeouts
- Security headers
- Validation

### Priority 6 — Polish

Only after the complete flow works.

---

# 15. Two-Hour MVP Plan

## 0–15 minutes

Project setup.

Goal:

```text
npm install
npm run dev
```

works.

Immediately test the chosen resolver against a real public X video.

---

## 15–40 minutes

Implement:

```text
VideoResolver
XVideoResolver
VideoService
POST /api/videos/resolve
```

Goal:

```text
curl → API → real video metadata
```

---

## 40–65 minutes

Build the frontend.

Goal:

```text
Paste URL
→ Fetch
→ Display video
```

---

## 65–85 minutes

Implement download/playback.

Goal:

```text
Select 720p
→ Download/play video
```

---

## 85–105 minutes

Add basic hardening:

- Validation
- Error handling
- Rate limiting
- Timeouts
- Helmet
- CORS

---

## 105–120 minutes

Clean up:

- README
- Environment variables
- Basic tests
- Error messages
- UI polish

---

# 16. What NOT To Build Yet

Do not build these in the MVP:

```text
User accounts
Authentication
Database
Download history
Favorites
Cloud storage
Video transcoding
Video conversion
Analytics
Admin dashboard
Subscriptions
Payment
Redis
Queues
Workers
Microservices
Kubernetes
Load balancers
```

These can be considered only after the basic product proves useful.

---

# 17. Future Architecture

If XDrop grows significantly, the architecture can evolve.

```text
                    ┌───────────────┐
                    │   Frontend    │
                    └───────┬───────┘
                            │
                            ▼
                    ┌───────────────┐
                    │      API      │
                    └───────┬───────┘
                            │
                            ▼
                    ┌────────────────┐
                    │ Video Service  │
                    └───────┬────────┘
                            │
                    ┌───────┴────────┐
                    ▼                ▼
             Resolver Pool      Cache Layer
                    │
                    ▼
                X Media
```

But this is **future work**.

The initial implementation should remain a modular monolith.

---

# 18. Definition of Done

XDrop MVP is complete when:

1. The application starts locally.
2. A user can paste a public X post URL.
3. The backend validates the URL.
4. The resolver successfully finds a public video.
5. The API returns normalized video metadata.
6. The frontend displays the video/thumbnail.
7. Available qualities are shown.
8. The user can play or download at least one quality.
9. Resolver failures are handled gracefully.
10. No database or external infrastructure is required.

The most important success criterion is:

> **A real X video URL → XDrop → working video download.**

Everything else is secondary for the MVP.
