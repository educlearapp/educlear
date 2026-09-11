import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/** Public Meta Pixel ID. This is not a secret — Meta requires it in the page. */
const META_PIXEL_ID = "1086897697385902";

/**
 * Marketing and legal pages only. Authenticated product apps share this SPA
 * and must not load the pixel.
 */
const PUBLIC_WEBSITE_PATHS = new Set([
  "/",
  "/login",
  "/register-school",
  "/terms-and-conditions",
  "/refund-and-cancellation-policy",
  "/privacy-policy",
]);

type Fbq = {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  loaded: boolean;
  version: string;
  push: Fbq;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export function isPublicWebsitePath(pathname: string): boolean {
  return PUBLIC_WEBSITE_PATHS.has(normalizePath(pathname));
}

function installMetaPixel(): void {
  if (window.fbq) return;

  const n = function (this: Fbq, ...args: unknown[]) {
    if (n.callMethod) {
      n.callMethod.apply(n, args);
      return;
    }
    n.queue.push(args);
  } as Fbq;

  if (!window._fbq) window._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = "2.0";
  n.queue = [];
  window.fbq = n;

  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  const firstScript = document.getElementsByTagName("script")[0];
  firstScript?.parentNode?.insertBefore(script, firstScript);

  n("init", META_PIXEL_ID);
}

let lastTrackedPath: string | null = null;

function trackPublicPageView(pathname: string): void {
  const path = normalizePath(pathname);
  if (lastTrackedPath === path) return;
  lastTrackedPath = path;
  window.fbq?.("track", "PageView");
}

export default function MetaPixel() {
  const { pathname } = useLocation();
  const onPublicPage = isPublicWebsitePath(pathname);

  useEffect(() => {
    if (!onPublicPage) return;
    installMetaPixel();
    trackPublicPageView(pathname);
  }, [onPublicPage, pathname]);

  if (!onPublicPage) return null;

  return (
    <noscript>
      <img
        height="1"
        width="1"
        style={{ display: "none" }}
        alt=""
        src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
      />
    </noscript>
  );
}
