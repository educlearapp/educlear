import daSilvaCrestUrl from "../assets/letterheads/da-silva-crest.png";
import daSilvaHeadingUrl from "../assets/letterheads/da-silva-heading.png";
import flyEagleCrestUrl from "../assets/letterheads/fly-eagle-crest.jpg";
import {
  resolvePayslipLetterheadId,
  type LetterheadImage,
  type LetterheadImageKey,
  type LetterheadImages,
  type PayslipLetterheadId,
} from "./payslipLetterheads";

/** Official artwork per letterhead. */
const ASSET_URLS: Record<PayslipLetterheadId, Partial<Record<LetterheadImageKey, string>>> = {
  "fly-eagle": { crest: flyEagleCrestUrl },
  "da-silva": { crest: daSilvaCrestUrl, heading: daSilvaHeadingUrl },
};

async function loadImage(url: string): Promise<LetterheadImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("image decode failed"));
      img.src = dataUrl;
    });
    return { dataUrl, ...dims, format: blob.type === "image/jpeg" ? "JPEG" : "PNG" };
  } catch {
    return null;
  }
}

/** Loads only the artwork belonging to the given school's letterhead. */
export async function loadPayslipLetterheadImages(
  schoolId: string | null | undefined
): Promise<Partial<Record<PayslipLetterheadId, LetterheadImages>>> {
  const id = resolvePayslipLetterheadId(schoolId);
  if (!id) return {};
  const images: LetterheadImages = {};
  for (const [key, url] of Object.entries(ASSET_URLS[id]) as Array<[LetterheadImageKey, string]>) {
    const img = await loadImage(url);
    if (img) images[key] = img;
  }
  return { [id]: images };
}
