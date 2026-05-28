-- Add universal migration profile fields (nickname, notes, employer)

ALTER TABLE "Parent" ADD COLUMN     "employer" TEXT;

ALTER TABLE "Learner" ADD COLUMN     "nickname" TEXT;
ALTER TABLE "Learner" ADD COLUMN     "notes" TEXT;

