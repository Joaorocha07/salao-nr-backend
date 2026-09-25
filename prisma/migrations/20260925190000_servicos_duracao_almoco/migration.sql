-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "botLunchEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "botLunchEnd" TEXT NOT NULL DEFAULT '13:00',
ADD COLUMN     "botLunchStart" TEXT NOT NULL DEFAULT '12:00',
ADD COLUMN     "serviceDurations" JSONB NOT NULL DEFAULT '{}';

