-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "appointmentConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "appointmentReminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "botPauseHours" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "botPauseOnStaffReply" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "botReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "botReminderMessage" TEXT NOT NULL DEFAULT 'Oi, {nome}! Passando para lembrar do seu horário amanhã: {servico} no dia {data} às {hora}. Está tudo certo?',
ADD COLUMN     "botReminderTime" TEXT NOT NULL DEFAULT '10:00',
ADD COLUMN     "botSlotCapacity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "botSlotMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "saveContactOnWhatsApp" BOOLEAN NOT NULL DEFAULT true;

