-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "whatsappId" TEXT;

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "botClosingTime" TEXT NOT NULL DEFAULT '19:00',
ADD COLUMN     "botConfirmationMessage" TEXT NOT NULL DEFAULT 'Agendado! {servico} no dia {data} às {hora}. Até lá, {nome}!',
ADD COLUMN     "botEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "botHandoffMessage" TEXT NOT NULL DEFAULT 'Certo! Uma pessoa da nossa equipe vai te responder por aqui em instantes.',
ADD COLUMN     "botOpeningTime" TEXT NOT NULL DEFAULT '09:00',
ADD COLUMN     "botSchedulingEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "botWorkDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[];

-- CreateIndex
CREATE INDEX "leads_companyId_whatsappId_idx" ON "leads"("companyId", "whatsappId");

