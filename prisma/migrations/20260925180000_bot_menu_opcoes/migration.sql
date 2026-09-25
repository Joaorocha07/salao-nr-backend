-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "botMenuOptions" TEXT[] DEFAULT ARRAY['agendar', 'ver', 'remarcar', 'equipe']::TEXT[];

