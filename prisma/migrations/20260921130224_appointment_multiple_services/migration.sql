-- AlterTable
ALTER TABLE "leads" DROP COLUMN "appointmentService";
ALTER TABLE "leads" ADD COLUMN     "appointmentServices" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
