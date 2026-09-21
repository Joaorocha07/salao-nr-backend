-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "interests" TEXT[] NOT NULL DEFAULT ARRAY['Corte', 'Coloração', 'Progressiva', 'Manicure']::TEXT[];
