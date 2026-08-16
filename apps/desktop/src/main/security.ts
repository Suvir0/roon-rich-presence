import { isAbsolute, join, normalize, relative, sep } from 'node:path';

export function rendererUrlIsTrusted(url: string, developmentUrl?: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'rrp:' && parsed.hostname === 'app') return true;
    return Boolean(developmentUrl && parsed.origin === new URL(developmentUrl).origin);
  } catch {
    return false;
  }
}

export function resolveRendererAssetPath(root: string, requestUrl: string): string | undefined {
  try {
    // Reject encoded separators/dot segments before URL normalisation can erase them.
    if (/%(?:2e|2f|5c)/i.test(requestUrl)) return undefined;
    const url = new URL(requestUrl);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\0')) return undefined;
    const assetPath = pathname === '/' ? 'index.html' : pathname.slice(1);
    const normalizedRoot = normalize(root);
    const requested = normalize(join(normalizedRoot, assetPath));
    const fromRoot = relative(normalizedRoot, requested);
    if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
      return undefined;
    }
    return requested;
  } catch {
    return undefined;
  }
}
