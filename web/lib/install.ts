// Client-side "install AnyDrop" helpers — pure functions plus tiny
// localStorage wrappers, so InstallPrompt.tsx stays mostly UI.
//
// Why this exists at all: the browser's own install prompt
// (`beforeinstallprompt`) can't be relied on to offer installation.
//   - Safari (iPhone/iPad/Mac) and Firefox never fire it.
//   - Chrome stops firing it for a long time once someone dismisses it,
//     and each event can only be used once.
// So AnyDrop always offers an install button and falls back to telling
// people where their browser keeps its own "install" menu item.

export type InstallEnvironment =
  | "ios" // iPhone/iPad — any browser (all are WebKit; Share → Add to Home Screen)
  | "android"
  | "mac-safari" // macOS Sonoma+: File → Add to Dock
  | "desktop-chromium" // Chrome / Edge / Brave / Opera on desktop
  | "unsupported"; // e.g. desktop Firefox — can't install web apps

/** Classifies a browser from its user agent (+ touch support, for iPadOS). */
export function detectInstallEnvironment(userAgent: string, maxTouchPoints = 0): InstallEnvironment {
  const ua = userAgent.toLowerCase();
  // iPadOS 13+ reports a desktop Mac user agent; touch support gives it away.
  if (/iphone|ipad|ipod/.test(ua) || (ua.includes("macintosh") && maxTouchPoints > 1)) return "ios";
  if (ua.includes("android")) return "android";
  if (/edg\/|chrome\/|chromium\/|opr\//.test(ua)) return "desktop-chromium";
  if (ua.includes("macintosh") && ua.includes("safari/")) return "mac-safari";
  return "unsupported";
}

/** Short manual-install steps for browsers where we can't open a prompt ourselves. */
export function installInstructions(env: InstallEnvironment): string {
  switch (env) {
    case "ios":
      return "Tap the Share button, then “Add to Home Screen”.";
    case "android":
      return "Open your browser menu (⋮), then tap “Install app” or “Add to Home screen”.";
    case "mac-safari":
      return "In the menu bar, choose File → “Add to Dock”.";
    case "desktop-chromium":
      return "Click the install icon at the right end of the address bar, or choose “Install AnyDrop” from the browser menu.";
    case "unsupported":
      return "This browser can't install apps. Open AnyDrop in Chrome, Edge or Safari to install it.";
  }
}

// "Not now" hides the button for a while instead of forever — people who
// dismissed it once should still get a second chance later.
export const DISMISS_FOR_MS = 7 * 24 * 60 * 60 * 1000;

const DISMISSED_KEY = "anydrop:install-dismissed-at";
const INSTALLED_KEY = "anydrop:installed";

export function isDismissed(dismissedAt: number | null, now = Date.now()): boolean {
  return dismissedAt !== null && now - dismissedAt < DISMISS_FOR_MS;
}

export function loadDismissedAt(): number | null {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveDismissedAt(now = Date.now()): void {
  try {
    localStorage.setItem(DISMISSED_KEY, String(now));
  } catch {
    // ignore — the button just comes back on the next visit
  }
}

// A remembered "this device has the app installed" flag. On Android the
// installed app shares the browser's storage, so a flag written while
// running installed (or on the `appinstalled` event) is visible from a
// normal tab too. It goes stale if the app is later uninstalled — which is
// why the browser offering to install again clears it (see InstallPrompt).
export function loadInstalledFlag(): boolean {
  try {
    return localStorage.getItem(INSTALLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveInstalledFlag(installed: boolean): void {
  try {
    if (installed) localStorage.setItem(INSTALLED_KEY, "1");
    else localStorage.removeItem(INSTALLED_KEY);
  } catch {
    // ignore — only affects which hint is shown
  }
}
