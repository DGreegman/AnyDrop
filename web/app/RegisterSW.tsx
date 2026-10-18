"use client";

import { useEffect } from "react";

/** Registers the PWA service worker (see public/sw.js). Renders nothing. */
export default function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Non-fatal — AnyDrop works the same without it, just not installable.
      });
    }
  }, []);

  return null;
}
