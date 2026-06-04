/** Canonical EduClear logo used to generate Teacher Portal PWA icons. */
export const EDUCLEAR_PWA_SOURCE_LOGO_PATH = "src/assets/educlear-pwa-source.png";

/** Bump when regenerating icons so iPad/Safari cache busts. */
export const PWA_ICON_VERSION = "v2";

const v = PWA_ICON_VERSION;

export const teacherPwaIcons = {
  manifestHref: `/teacher-manifest.webmanifest?${v}`,
  manifestIcon192: `/teacher-pwa/educlear-teacher-icon-${v}-192.png`,
  manifestIcon512: `/teacher-pwa/educlear-teacher-icon-${v}-512.png`,
  manifestIcon512Maskable: `/teacher-pwa/educlear-teacher-icon-${v}-512-maskable.png`,
  appleTouch180: `/teacher-pwa/educlear-teacher-apple-touch-${v}-180.png`,
} as const;

/** Main SPA favicon (school dashboard / login). */
export const mainEduClearIcon = `/educlear-main-icon-${v}-192.png`;

export type PortalPwaHeadConfig = {
  documentTitle: string;
  appleWebAppTitle: string;
  themeColor: string;
  manifestHref: string;
  appleTouch180: string;
  manifestIcon192: string;
  serviceWorkerPath?: string;
};

export const teacherPortalPwaHead: PortalPwaHeadConfig = {
  documentTitle: "EduClear Teacher Portal",
  appleWebAppTitle: "EduClear Teacher",
  themeColor: "#0a0a0a",
  manifestHref: teacherPwaIcons.manifestHref,
  appleTouch180: teacherPwaIcons.appleTouch180,
  manifestIcon192: teacherPwaIcons.manifestIcon192,
  serviceWorkerPath: "/teacher-sw.js",
};
