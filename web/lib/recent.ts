// Client-side "recent lookups" — localStorage only, no server/DB
// involvement at all. Purely a convenience for re-fetching a post you just
// looked at; losing this list (private browsing, cleared site data,
// another device) has no functional impact on the app.

export interface RecentEntry {
  sourceUrl: string;
  title?: string;
  thumbnail?: string;
  resolvedAt: number;
}

const STORAGE_KEY = "xdrop:recent";
const MAX_ENTRIES = 5;

export function loadRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addRecent(entry: Omit<RecentEntry, "resolvedAt">): RecentEntry[] {
  try {
    const existing = loadRecent().filter((e) => e.sourceUrl !== entry.sourceUrl);
    const next = [{ ...entry, resolvedAt: Date.now() }, ...existing].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return loadRecent();
  }
}

export function clearRecent(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore — nothing to clean up if storage isn't available
  }
}

/** e.g. "Just now", "5m ago", "3h ago", "2d ago". */
export function formatRelativeTime(ms: number): string {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSeconds < 60) return "Just now";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * XDrop only ever normalizes X post URLs to `https://x.com/<user>/status/<id>`
 * (see lib/videos/validator.ts) — the handle is already right there in the
 * URL, so there's no need to ask the backend for an "author" field.
 */
export function extractHandle(sourceUrl: string): string | null {
  const match = sourceUrl.match(/^https:\/\/x\.com\/([A-Za-z0-9_]+)\/status\/\d+/);
  return match ? match[1] : null;
}
