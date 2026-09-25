-- CreateEnum
CREATE TYPE "AppointmentEventType" AS ENUM ('AGENDADO', 'REMARCADO', 'CANCELADO', 'CONFIRMADO');

-- CreateTable
CREATE TABLE "appointment_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "AppointmentEventType" NOT NULL,
    "date" TEXT NOT NULL,
    "time" TEXT,
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "previousDate" TEXT,
    "previousTime" TEXT,
    "source" TEXT NOT NULL DEFAULT 'crm',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointment_events_companyId_date_idx" ON "appointment_events"("companyId", "date");

-- CreateIndex
CREATE INDEX "appointment_events_companyId_previousDate_idx" ON "appointment_events"("companyId", "previousDate");

-- AddForeignKey
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

