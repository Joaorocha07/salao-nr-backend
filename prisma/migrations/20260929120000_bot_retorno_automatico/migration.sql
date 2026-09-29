-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "notClosedAt" TIMESTAMP(3),
ADD COLUMN     "lastClientMessageAt" TIMESTAMP(3),
ADD COLUMN     "followUpSentAt" TIMESTAMP(3),
ADD COLUMN     "followUpKind" TEXT;

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "botAudience" TEXT NOT NULL DEFAULT 'todos',
ADD COLUMN     "botFollowUpNotClosedEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "botFollowUpNotClosedDays" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "botFollowUpNotClosedMessage" TEXT NOT NULL DEFAULT 'Oi, {nome}! Tudo bem? Passando para saber se você ainda quer agendar um horário com a gente.',
ADD COLUMN     "botFollowUpInactiveEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "botFollowUpInactiveDays" INTEGER NOT NULL DEFAULT 25,
ADD COLUMN     "botFollowUpInactiveMessage" TEXT NOT NULL DEFAULT 'Oi, {nome}! Sentimos sua falta por aqui. Que tal agendar um horário?',
ADD COLUMN     "botFollowUpDailyLimit" INTEGER NOT NULL DEFAULT 30;

-- Clientes já marcados como "Não fechou": o prazo conta da última alteração.
UPDATE "leads" SET "notClosedAt" = "updatedAt" WHERE "status" = 'NAO_FECHOU';

-- Última mensagem do cliente, a partir do histórico salvo.
UPDATE "leads" l SET "lastClientMessageAt" = m.last
FROM (SELECT "leadId", max("createdAt") AS last FROM "lead_messages" WHERE "own" = false GROUP BY "leadId") m
WHERE m."leadId" = l."id";
