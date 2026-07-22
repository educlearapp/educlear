import { usePortalPwaHead } from "../pwa/usePortalPwaHead";
import { adminHomeSafePwaHead } from "../pwa/pwaIconConfig";

/** Applies HomeSafe Admin document title + iPad Home Screen meta (main EduClear icon). */
export default function AdminHomeSafePwaHead() {
  usePortalPwaHead(adminHomeSafePwaHead);
  return null;
}
