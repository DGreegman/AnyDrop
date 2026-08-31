import { AppError } from "./errors";
import { MediaResolver, Platform } from "./types";
import { XVideoResolver } from "./x/resolver";
import { InstagramResolver } from "./instagram/resolver";

const PLATFORM_LABELS: Record<Platform, string> = {
  x: "X",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
};

/**
 * Platform -> MediaResolver factory. "x" and "instagram" are implemented;
 * platform-detector.ts already recognizes tiktok/facebook URLs too (so
 * the app can tell users "yes, that's a TikTok link" vs "I don't know
 * what that is"), but there's deliberately no resolver registered for
 * them yet — adding one later is exactly one new entry here plus a new
 * `<platform>/resolver.ts`, no other file needs to change.
 */
const resolverFactories: Partial<Record<Platform, () => MediaResolver>> = {
  x: () => new XVideoResolver(),
  instagram: () => new InstagramResolver(),
};

// One resolver instance per platform, built lazily on first use, rather
// than a fresh instance per request.
const instances = new Map<Platform, MediaResolver>();

export function getResolver(platform: Platform): MediaResolver {
  const cached = instances.get(platform);
  if (cached) return cached;

  const factory = resolverFactories[platform];
  if (!factory) {
    throw new AppError(
      "UNSUPPORTED_URL",
      `${PLATFORM_LABELS[platform]} isn't supported yet — X is the only supported platform right now.`
    );
  }

  const instance = factory();
  instances.set(platform, instance);
  return instance;
}
