-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "whatsappCloudPhoneNumberId" TEXT,
ADD COLUMN     "whatsappCloudToken" TEXT,
ADD COLUMN     "whatsappCloudWabaId" TEXT,
ADD COLUMN     "whatsappProvider" TEXT NOT NULL DEFAULT 'web',
ADD COLUMN     "whatsappTemplates" JSONB NOT NULL DEFAULT '{}';

-- CreateIndex
CREATE UNIQUE INDEX "company_settings_whatsappCloudPhoneNumberId_key" ON "company_settings"("whatsappCloudPhoneNumberId");

