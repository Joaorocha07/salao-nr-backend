-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "firstContactAt" TIMESTAMP(3),
ADD COLUMN     "followUpCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "botAskNameMessage" TEXT NOT NULL DEFAULT 'Olá! Seja bem-vinda ao nosso espaço. Para começarmos, qual é o seu nome?',
ADD COLUMN     "botCaptureWelcomeMessage" TEXT NOT NULL DEFAULT 'Olá, {nome}! Seja bem-vinda ao nosso espaço. Em breve nosso time vai entrar em contato com você.',
ADD COLUMN     "botFollowUpLeadEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "botFollowUpLeadFirstDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "botFollowUpLeadFirstMessage" TEXT NOT NULL DEFAULT 'Olá, {nome}! Tudo bem? Estamos passando para retomar aquele assunto do seu agendamento. Estamos com várias condições especiais. Vamos agendar o seu horário?',
ADD COLUMN     "botFollowUpLeadRepeatDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "botFollowUpLeadRepeatMessage" TEXT NOT NULL DEFAULT 'Olá, {nome}! Tudo bem? Estamos com várias condições especiais neste mês. Vamos agendar o seu horário?',
ADD COLUMN     "botMode" TEXT NOT NULL DEFAULT 'menu',
ADD COLUMN     "situationFrequentMonths" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN     "situationFrequentVisits" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "situationInactiveDays" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "whatsapp_contacts" (
    "companyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_contacts_pkey" PRIMARY KEY ("companyId","contactId")
);

-- AddForeignKey
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

