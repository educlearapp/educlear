import { useEffect } from "react";
import type { PortalPwaHeadConfig } from "./pwaIconConfig";

export function usePortalPwaHead(config: PortalPwaHeadConfig): void {
  useEffect(() => {
    const head = document.head;
    const added: HTMLElement[] = [];
    const append = (el: HTMLElement) => {
      head.appendChild(el);
      added.push(el);
    };

    const manifest = document.createElement("link");
    manifest.rel = "manifest";
    manifest.href = config.manifestHref;
    append(manifest);

    const theme = document.createElement("meta");
    theme.name = "theme-color";
    theme.content = config.themeColor;
    append(theme);

    const appleCap = document.createElement("meta");
    appleCap.name = "apple-mobile-web-app-capable";
    appleCap.content = "yes";
    append(appleCap);

    const appleTitle = document.createElement("meta");
    appleTitle.name = "apple-mobile-web-app-title";
    appleTitle.content = config.appleWebAppTitle;
    append(appleTitle);

    const appleStatus = document.createElement("meta");
    appleStatus.name = "apple-mobile-web-app-status-bar-style";
    appleStatus.content = "black-translucent";
    append(appleStatus);

    const appleTouch = document.createElement("link");
    appleTouch.rel = "apple-touch-icon";
    appleTouch.href = config.appleTouch180;
    appleTouch.setAttribute("sizes", "180x180");
    append(appleTouch);

    const appleTouchHd = document.createElement("link");
    appleTouchHd.rel = "apple-touch-icon";
    appleTouchHd.href = config.manifestIcon192;
    appleTouchHd.setAttribute("sizes", "192x192");
    append(appleTouchHd);

    const prevTitle = document.title;
    document.title = config.documentTitle;

    return () => {
      for (const el of added) {
        head.removeChild(el);
      }
      document.title = prevTitle;
    };
  }, [
    config.appleTouch180,
    config.appleWebAppTitle,
    config.documentTitle,
    config.manifestHref,
    config.manifestIcon192,
    config.themeColor,
  ]);

  useEffect(() => {
    if (!config.serviceWorkerPath || !("serviceWorker" in navigator)) return;

    const register = async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) {
        const script =
          reg.active?.scriptURL ?? reg.installing?.scriptURL ?? reg.waiting?.scriptURL ?? "";
        if (script.endsWith("/teacher-sw.js") && reg.scope === `${window.location.origin}/`) {
          await reg.unregister();
        }
      }

      const options = config.serviceWorkerScope ? { scope: config.serviceWorkerScope } : undefined;
      await navigator.serviceWorker.register(config.serviceWorkerPath!, options);
    };

    void register().catch(() => {});
  }, [config.serviceWorkerPath, config.serviceWorkerScope]);
}
