-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "appointmentBookedAt" TIMESTAMP(3),
ADD COLUMN     "appointmentHourReminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "botHourReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "botHourReminderMessage" TEXT NOT NULL DEFAULT 'Oi, {nome}! Seu horário é hoje às {hora}: {servico}. Te esperamos!',
ADD COLUMN     "botHourReminderMinutes" INTEGER NOT NULL DEFAULT 60;

