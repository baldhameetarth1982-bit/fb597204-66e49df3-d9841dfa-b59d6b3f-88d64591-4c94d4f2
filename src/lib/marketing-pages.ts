/** Marketing trackers run only on public pages — never inside signed-in society screens. */
const PUBLIC_PREFIXES = ["/pricing", "/about", "/founders", "/contact", "/support", "/legal", "/privacy", "/terms", "/refund", "/gdpr"];
export function isMarketingPage(path: string) {
  return path === "/" || PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
}
