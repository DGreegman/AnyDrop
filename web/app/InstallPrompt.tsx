"use client";

import { useEffect, useState } from "react";
import {
  InstallEnvironment,
  detectInstallEnvironment,
  installInstructions,
  isDismissed,
  loadDismissedAt,
  loadInstalledFlag,
  saveDismissedAt,
  saveInstalledFlag,
} from "@/lib/install";

// Chrome/Edge/Samsung Internet fire this when the page is installable;
// not part of TypeScript's DOM lib.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Chrome on Android only (needs `related_applications` in manifest.ts);
// not part of TypeScript's DOM lib.
type NavigatorWithInstalledApps = Navigator & {
  getInstalledRelatedApps?: () => Promise<Array<{ platform: string }>>;
  standalone?: boolean;
};

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  (navigator as NavigatorWithInstalledApps).standalone === true;

type Mode =
  | { kind: "hidden" } // running installed, dismissed, or not mounted yet
  | { kind: "install"; env: InstallEnvironment }
  | { kind: "installed" }; // installed on this device, but opened in a browser tab

/**
 * The "Install app" button under the hero. Always offered (unless already
 * running as the installed app, or "Not now" was tapped in the last week):
 * opens the browser's own install prompt when one is available, and
 * otherwise shows where that browser keeps its install option — see
 * lib/install.ts for why the browser prompt alone isn't enough.
 */
export default function InstallPrompt() {
  const [mode, setMode] = useState<Mode>({ kind: "hidden" });
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    // Everything here reads window/navigator/localStorage, so it runs
    // after mount — the server render always starts out hidden.
    if (isStandalone()) {
      saveInstalledFlag(true);
      return;
    }
    if (isDismissed(loadDismissedAt())) return;

    const env = detectInstallEnvironment(navigator.userAgent, navigator.maxTouchPoints);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(loadInstalledFlag() ? { kind: "installed" } : { kind: "install", env });

    let cancelled = false;
    (navigator as NavigatorWithInstalledApps)
      .getInstalledRelatedApps?.()
      .then((apps) => {
        if (cancelled || apps.length === 0) return;
        saveInstalledFlag(true);
        setMode({ kind: "installed" });
      })
      .catch(() => undefined);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      // The browser only offers this when the app is *not* installed, so a
      // remembered "installed" flag is stale (the app was uninstalled).
      saveInstalledFlag(false);
      setDeferred(e as BeforeInstallPromptEvent);
      setMode({ kind: "install", env });
    };
    const onInstalled = () => {
      saveInstalledFlag(true);
      setDeferred(null);
      setShowHelp(false);
      setMode({ kind: "installed" });
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      cancelled = true;
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!deferred) {
      setShowHelp((open) => !open);
      return;
    }
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    // Each event can only be used once. If they said no, the next tap
    // shows the manual steps rather than a button that does nothing.
    setDeferred(null);
  }

  function handleDismiss() {
    saveDismissedAt();
    setMode({ kind: "hidden" });
  }

  if (mode.kind === "hidden") return null;

  if (mode.kind === "installed") {
    return (
      <div className="install">
        <p className="install-note">
          XDrop is installed on this device — open it from your home screen, or share a video to it.
          <button type="button" className="install-dismiss" onClick={handleDismiss} aria-label="Hide this message">
            ×
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="install">
      <div className="install-row">
        <button type="button" className="install-btn" onClick={handleInstall} aria-expanded={deferred ? undefined : showHelp}>
          Install app — then share videos to XDrop
        </button>
        <button type="button" className="install-dismiss" onClick={handleDismiss}>
          Not now
        </button>
      </div>
      {showHelp && !deferred && <p className="install-note">{installInstructions(mode.env)}</p>}
    </div>
  );
}
