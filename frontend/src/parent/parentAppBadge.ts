/**
 * Optional app-icon badge (Badging API). Number only — never learner names.
 */

export async function setParentAppBadge(count: number): Promise<void> {
  if (typeof navigator === "undefined") return;
  const n = Math.max(0, Math.floor(Number(count) || 0));
  try {
    if (n <= 0) {
      if ("clearAppBadge" in navigator) {
        await (navigator as Navigator & { clearAppBadge: () => Promise<void> }).clearAppBadge();
      }
      return;
    }
    if ("setAppBadge" in navigator) {
      await (navigator as Navigator & { setAppBadge: (c?: number) => Promise<void> }).setAppBadge(
        Math.min(n, 99)
      );
    }
  } catch {
    /* unsupported / denied */
  }
}

export async function clearParentAppBadge(): Promise<void> {
  await setParentAppBadge(0);
}
