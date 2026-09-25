-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN "whatsappPhoneNumberId" TEXT;
ALTER TABLE "company_settings" ADD COLUMN "whatsappBusinessAccountId" TEXT;
ALTER TABLE "company_settings" ADD COLUMN "whatsappAccessTokenEnc" TEXT;

-- CreateTable
CREATE TABLE "whatsapp_sessions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_sessions_companyId_phone_key" ON "whatsapp_sessions"("companyId", "phone");

-- AddForeignKey
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
