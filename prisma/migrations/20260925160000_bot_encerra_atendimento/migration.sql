-- AlterTable
ALTER TABLE "company_settings" DROP COLUMN "botPauseHours",
ADD COLUMN     "botHumanEndMessage" TEXT NOT NULL DEFAULT 'Seu atendimento com a nossa equipe foi encerrado. Obrigado pelo contato!',
ADD COLUMN     "botHumanTimeoutMinutes" INTEGER NOT NULL DEFAULT 10;

