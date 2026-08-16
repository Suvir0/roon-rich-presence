import { describe, expect, it } from 'vitest';
import { rendererUrlIsTrusted, resolveRendererAssetPath } from './security';

describe('main-process trust boundaries', () => {
  it('accepts only the exact application host or development origin', () => {
    expect(rendererUrlIsTrusted('rrp://app/index.html')).toBe(true);
    expect(rendererUrlIsTrusted('rrp://app.evil.test/index.html')).toBe(false);
    expect(rendererUrlIsTrusted('not a url')).toBe(false);
    expect(rendererUrlIsTrusted('http://localhost:5173/index.html', 'http://localhost:5173/')).toBe(
      true
    );
    expect(rendererUrlIsTrusted('http://localhost:5173.evil.test/', 'http://localhost:5173/')).toBe(
      false
    );
  });

  it('keeps custom-protocol assets inside the renderer directory', () => {
    const root = '/application/out/renderer';
    expect(resolveRendererAssetPath(root, 'rrp://app/')).toBe(`${root}/index.html`);
    expect(resolveRendererAssetPath(root, 'rrp://app/assets/index.js')).toBe(
      `${root}/assets/index.js`
    );
    expect(resolveRendererAssetPath(root, 'rrp://app/%2e%2e/main/index.js')).toBeUndefined();
    expect(resolveRendererAssetPath(root, 'rrp://app/%E0%A4%A')).toBeUndefined();
  });
});
