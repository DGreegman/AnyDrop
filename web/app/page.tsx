import { connection } from "next/server";
import HomeClient from "./HomeClient";

/**
 * Server Component wrapper. proxy.ts (Next's Middleware/Proxy) generates a
 * fresh CSP nonce per request; that only lines up with what actually gets
 * rendered if this page is dynamically rendered per request rather than
 * prerendered once at build time. `connection()` forces that — see
 * https://nextjs.org/docs/app/guides/content-security-policy.
 */
export default async function Page() {
  await connection();
  return <HomeClient />;
}
