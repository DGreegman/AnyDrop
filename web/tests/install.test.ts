import { describe, expect, it } from "vitest";
import { DISMISS_FOR_MS, detectInstallEnvironment, installInstructions, isDismissed } from "@/lib/install";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
  // iPadOS 13+ claims to be a Mac.
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
};

describe("detectInstallEnvironment", () => {
  it("treats every iPhone browser as iOS", () => {
    expect(detectInstallEnvironment(UA.iphoneSafari)).toBe("ios");
    expect(detectInstallEnvironment(UA.iphoneChrome)).toBe("ios");
  });

  it("tells an iPad (Mac user agent + touch) apart from a real Mac", () => {
    expect(detectInstallEnvironment(UA.ipad, 5)).toBe("ios");
    expect(detectInstallEnvironment(UA.macSafari, 0)).toBe("mac-safari");
  });

  it("detects Android regardless of browser", () => {
    expect(detectInstallEnvironment(UA.androidChrome)).toBe("android");
    expect(detectInstallEnvironment(UA.androidFirefox)).toBe("android");
  });

  it("detects desktop Chromium browsers", () => {
    expect(detectInstallEnvironment(UA.windowsEdge)).toBe("desktop-chromium");
    expect(detectInstallEnvironment(UA.macChrome)).toBe("desktop-chromium");
  });

  it("marks desktop Firefox as unable to install", () => {
    expect(detectInstallEnvironment(UA.linuxFirefox)).toBe("unsupported");
  });
});

describe("installInstructions", () => {
  it("points iOS users at Add to Home Screen", () => {
    expect(installInstructions("ios")).toMatch(/Add to Home Screen/);
  });

  it("suggests another browser when installing isn't possible", () => {
    expect(installInstructions("unsupported")).toMatch(/Chrome, Edge or Safari/);
  });
});

describe("isDismissed", () => {
  const now = 1_000_000_000_000;

  it("is false when never dismissed", () => {
    expect(isDismissed(null, now)).toBe(false);
  });

  it("hides the button for a week, then offers it again", () => {
    expect(isDismissed(now - 1000, now)).toBe(true);
    expect(isDismissed(now - DISMISS_FOR_MS + 1, now)).toBe(true);
    expect(isDismissed(now - DISMISS_FOR_MS, now)).toBe(false);
  });
});
