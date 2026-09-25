-- AlterTable
ALTER TABLE "company_settings" DROP COLUMN "whatsappAccessTokenEnc",
DROP COLUMN "whatsappBusinessAccountId",
DROP COLUMN "whatsappPhoneNumberId",
ADD COLUMN     "whatsappPhone" TEXT;

-- CreateTable
CREATE TABLE "whatsapp_auth" (
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_auth_pkey" PRIMARY KEY ("companyId","key")
);

-- AddForeignKey
ALTER TABLE "whatsapp_auth" ADD CONSTRAINT "whatsapp_auth_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

