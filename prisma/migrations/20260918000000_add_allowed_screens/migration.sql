-- AlterTable
ALTER TABLE "company_memberships" ADD COLUMN     "allowedScreens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
