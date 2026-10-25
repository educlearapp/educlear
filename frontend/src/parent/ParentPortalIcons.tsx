/** Compact professional SVG icons for Parent Portal (no emoji). */

import type { ReactNode } from "react";

type IconProps = { className?: string; title?: string };

function Svg({ className, title, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export function PortalIcon({ name, className }: { name: string; className?: string }) {
  switch (name) {
    case "home":
      return (
        <Svg className={className}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 10v10h14V10" />
        </Svg>
      );
    case "messages":
      return (
        <Svg className={className}>
          <path d="M4 5h16v12H8l-4 3V5z" />
        </Svg>
      );
    case "finance":
      return (
        <Svg className={className}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M3 10h18" />
        </Svg>
      );
    case "alerts":
      return (
        <Svg className={className}>
          <path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 7H3s3 0 3-7" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </Svg>
      );
    case "homework":
      return (
        <Svg className={className}>
          <path d="M7 3h8l4 4v14H7V3z" />
          <path d="M15 3v4h4" />
          <path d="M9 13h6M9 17h6" />
        </Svg>
      );
    case "notices":
      return (
        <Svg className={className}>
          <path d="M12 3v2" />
          <path d="M6 9h12v10H6z" />
          <path d="M9 13h6" />
        </Svg>
      );
    case "events":
      return (
        <Svg className={className}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </Svg>
      );
    case "documents":
      return (
        <Svg className={className}>
          <path d="M8 4h6l4 4v12H8V4z" />
          <path d="M14 4v4h4" />
        </Svg>
      );
    case "incidents":
      return (
        <Svg className={className}>
          <path d="M12 3 21 19H3L12 3z" />
          <path d="M12 9v5M12 16.5h.01" />
        </Svg>
      );
    case "settings":
      return (
        <Svg className={className}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" />
        </Svg>
      );
    case "chevron":
      return (
        <Svg className={className}>
          <path d="M9 6l6 6-6 6" />
        </Svg>
      );
    case "profile":
      return (
        <Svg className={className}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 19c1.8-3.2 4.2-4.5 7-4.5s5.2 1.3 7 4.5" />
        </Svg>
      );
    default:
      return (
        <Svg className={className}>
          <circle cx="12" cy="12" r="8" />
        </Svg>
      );
  }
}
