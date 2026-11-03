/**
 * Resolves renderer assets against Vite's packaged document location.
 * This keeps the same call sites working in development (http:) and in the
 * packaged Electron renderer (file:) where root-relative URLs are invalid.
 */
export function assetUrl(path, baseUrl = document.baseURI) {
  return new URL(String(path).replace(/^\/+/, ''), baseUrl).href
}
