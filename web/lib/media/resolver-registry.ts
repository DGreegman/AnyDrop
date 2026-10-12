import { AppError } from "./errors";
import { MediaResolver, Platform } from "./types";
import { XVideoResolver } from "./x/resolver";
import { InstagramResolver } from "./instagram/resolver";
import { TikTokResolver } from "./tiktok/resolver";
import { FacebookResolver } from "./facebook/resolver";
import { PLATFORM_LABELS } from "./platforms";

/**
 * Platform -> MediaResolver factory. Every platform platform-detector.ts
 * recognizes has a resolver; the Partial<> and the error below stay so a
 * platform can be *recognized* ahead of being implemented (users get
 * "that's a <Platform> link, not supported yet" instead of "I don't know
 * what that is"). Adding one is one new entry here plus a new
 * `<platform>/resolver.ts`.
 */
const resolverFactories: Partial<Record<Platform, () => MediaResolver>> = {
  x: () => new XVideoResolver(),
  instagram: () => new InstagramResolver(),
  tiktok: () => new TikTokResolver(),
  facebook: () => new FacebookResolver(),
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
      `${PLATFORM_LABELS[platform]} isn't supported yet.`
    );
  }

  const instance = factory();
  instances.set(platform, instance);
  return instance;
}
