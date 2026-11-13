/** Only standalone public status URLs become embeds; never arbitrary hosts. */
export function tweetId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
    if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"].includes(parsed.hostname)) return null;
    return parsed.pathname.match(/^\/(?:[\w]{1,15}\/status|i\/web\/status)\/([0-9]{1,20})\/?$/)?.[1] ?? null;
  } catch { return null; }
}
