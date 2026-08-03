/**
 * EduClock staff location-permission helpers.
 * Location is requested only after Clock In / Clock Out / Retry Location (never on page load).
 */
export type EduClockPermissionQueryState = "granted" | "prompt" | "denied" | "unsupported";

export type EduClockDeviceGuidanceKind =
  | "iphone_safari"
  | "iphone_pwa"
  | "android_chrome"
  | "embedded_browser"
  | "generic";

export type EduClockLocationHelpContent = {
  kind: EduClockDeviceGuidanceKind;
  title: string;
  steps: string[];
  note?: string;
};

export async function queryGeolocationPermissionState(
  query?: Permissions["query"] | null
): Promise<EduClockPermissionQueryState> {
  const q =
    query ||
    (typeof navigator !== "undefined" && navigator.permissions?.query
      ? navigator.permissions.query.bind(navigator.permissions)
      : null);
  if (!q) return "unsupported";
  try {
    const status = await q({ name: "geolocation" as PermissionName });
    const state = String(status.state || "").toLowerCase();
    if (state === "granted" || state === "prompt" || state === "denied") return state;
    return "unsupported";
  } catch {
    // Safari often rejects Permissions.query for geolocation.
    return "unsupported";
  }
}

export function detectDeviceGuidanceKind(
  userAgent?: string,
  opts?: { standaloneDisplayMode?: boolean; standaloneNavigator?: boolean }
): EduClockDeviceGuidanceKind {
  const ua = String(userAgent || (typeof navigator !== "undefined" ? navigator.userAgent : "") || "");
  const lower = ua.toLowerCase();

  const standalone =
    opts?.standaloneDisplayMode ??
    (typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches);
  const iosStandalone =
    opts?.standaloneNavigator ??
    (typeof navigator !== "undefined" && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));

  // In-app / embedded browsers first.
  if (
    /; wv\)/i.test(ua) ||
    /webview/i.test(lower) ||
    /fbav|fban|fb_iab|instagram|line\/|micromessenger|whatsapp|tiktok|snapchat|twitter/i.test(lower)
  ) {
    return "embedded_browser";
  }

  const isIos = /iphone|ipad|ipod/i.test(ua);
  const isAndroid = /android/i.test(lower);
  const isChrome = /chrome|crios|chromium/i.test(lower) && !/edg\//i.test(lower);
  const isSafari = /safari/i.test(lower) && !/chrome|crios|chromium|android/i.test(lower);

  if (isIos && (standalone || iosStandalone)) return "iphone_pwa";
  if (isIos && (isSafari || !isChrome)) return "iphone_safari";
  if (isAndroid && isChrome) return "android_chrome";
  if (isAndroid) return "android_chrome";
  return "generic";
}

export function buildLocationHelpContent(kind: EduClockDeviceGuidanceKind): EduClockLocationHelpContent {
  switch (kind) {
    case "iphone_safari":
      return {
        kind,
        title: "Enable location for Safari",
        steps: [
          "Open iPhone Settings → Privacy & Security → Location Services.",
          "Turn Location Services on.",
          "Tap Safari Websites → set to While Using the App.",
          "Turn Precise Location on.",
          "Return here and tap Retry Location, then Clock In or Clock Out.",
        ],
        note: "If Safari previously blocked location for this site, clear the block under Settings → Safari → Location, then try again.",
      };
    case "iphone_pwa":
      return {
        kind,
        title: "Enable location for the EduClock app",
        steps: [
          "Open iPhone Settings → Privacy & Security → Location Services (must be on).",
          "Scroll to Safari Websites or the EduClock / browser entry for this Home Screen app.",
          "Choose While Using the App.",
          "Turn Precise Location on.",
          "Return to EduClock and tap Retry Location, then Clock In or Clock Out.",
        ],
        note: "Home Screen web apps use Safari’s location permission on iOS.",
      };
    case "android_chrome":
      return {
        kind,
        title: "Enable location for Chrome",
        steps: [
          "Open Android Settings → Apps → Chrome → Permissions → Location.",
          "Choose Allow only while using the app.",
          "Turn on Precise location if shown.",
          "In Chrome, tap the lock / tune icon next to the EduClock address and set Location to Allow.",
          "Return here and tap Retry Location, then Clock In or Clock Out.",
        ],
      };
    case "embedded_browser":
      return {
        kind,
        title: "Open EduClock in Safari or Chrome",
        steps: [
          "You appear to be inside WhatsApp, Facebook, Instagram, or another in-app browser.",
          "Those browsers often block or hide location prompts.",
          "Copy or open the EduClock link in Safari (iPhone) or Chrome (Android).",
          "Allow location when asked, then Clock In or Clock Out.",
        ],
      };
    default:
      return {
        kind: "generic",
        title: "Enable location permission",
        steps: [
          "Open your browser or phone Settings and allow Location for this site.",
          "Turn on precise / high-accuracy location if available.",
          "Return to EduClock and tap Retry Location, then Clock In or Clock Out.",
        ],
      };
  }
}

export function shouldShowLocationHelp(input: {
  permissionQueryState?: EduClockPermissionQueryState | null;
  geoFailureCode?: string | null;
}): boolean {
  if (input.permissionQueryState === "denied") return true;
  const code = String(input.geoFailureCode || "").toUpperCase();
  return code === "PERMISSION_DENIED" || code === "GPS_PERMISSION_DENIED";
}
