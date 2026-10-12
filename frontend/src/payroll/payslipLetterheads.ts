/**
 * School-specific payslip letterheads, selected only by the authorised school (tenant) id.
 * Schools without an entry keep the standard EduClear payslip.
 */

export const FLY_EAGLE_SCHOOL_ID = "cmt1e8bjp0jo8lcjeketlynhl";
export const DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";

export type PayslipLetterheadId = "fly-eagle" | "da-silva";

export type LetterheadImageKey = "crest" | "heading";

export type LetterheadImage = {
  dataUrl: string;
  /** Pixel dimensions, used to keep the official artwork's aspect ratio. */
  width: number;
  height: number;
  format: "PNG" | "JPEG";
};

export type LetterheadImages = Partial<Record<LetterheadImageKey, LetterheadImage>>;

export type FlyEagleLetterhead = {
  id: "fly-eagle";
  schoolName: string;
  motto: string;
  leftLines: string[];
  rightLines: string[];
};

export type DaSilvaLetterhead = {
  id: "da-silva";
  schoolName: string;
  motto: string;
  contactLines: string[];
};

export type PayslipLetterhead = FlyEagleLetterhead | DaSilvaLetterhead;

const LETTERHEADS: Record<PayslipLetterheadId, PayslipLetterhead> = {
  "fly-eagle": {
    id: "fly-eagle",
    schoolName: "Fly Eagle Primary School",
    motto: "Good foundation for good success",
    leftLines: [
      "P.O. Box 960, Rustenburg, 0300",
      "13 Lucas Street, Rustenburg CBD",
      "EMIS: 600105392",
      "Reg. No: 2011/112924/07",
    ],
    rightLines: [
      "Tel: (014) 008 5093 / 008 5199",
      "WhatsApp: 073 838 1975",
      "flyeagleschool@gmail.com",
      "www.flyeagleschool.co.za",
      "Facebook: Fly Eagle Primary School",
    ],
  },
  "da-silva": {
    id: "da-silva",
    schoolName: "Da Silva Academy",
    motto: "Be proud",
    contactLines: [
      "212 Klopper Street, Rustenburg, 0299  ·  EMIS: 600105372",
      "Tel: 014 592 5613  ·  Fax: (014) 592 5613  ·  dasilvaacademy@gmail.com",
    ],
  },
};

const LETTERHEAD_BY_SCHOOL_ID: Record<string, PayslipLetterheadId> = {
  [FLY_EAGLE_SCHOOL_ID]: "fly-eagle",
  [DA_SILVA_SCHOOL_ID]: "da-silva",
};

export function resolvePayslipLetterheadId(schoolId: string | null | undefined): PayslipLetterheadId | null {
  const sid = String(schoolId || "").trim();
  if (!sid || !Object.prototype.hasOwnProperty.call(LETTERHEAD_BY_SCHOOL_ID, sid)) return null;
  return LETTERHEAD_BY_SCHOOL_ID[sid];
}

export function resolvePayslipLetterhead(schoolId: string | null | undefined): PayslipLetterhead | null {
  const id = resolvePayslipLetterheadId(schoolId);
  return id ? LETTERHEADS[id] : null;
}
