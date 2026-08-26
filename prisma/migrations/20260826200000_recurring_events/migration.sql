-- AlterEnum
BEGIN;
CREATE TYPE "EventKind_new" AS ENUM ('EVENT', 'REMINDER', 'BACKGROUND');
ALTER TABLE "Event" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "Event" ALTER COLUMN "kind" TYPE "EventKind_new"
  USING (CASE WHEN "kind"::text = 'ACTIVE' THEN 'EVENT' ELSE "kind"::text END)::"EventKind_new";
ALTER TYPE "EventKind" RENAME TO "EventKind_old";
ALTER TYPE "EventKind_new" RENAME TO "EventKind";
DROP TYPE "EventKind_old";
ALTER TABLE "Event" ALTER COLUMN "kind" SET DEFAULT 'EVENT';
COMMIT;

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'EVENT_REMINDER';

-- AlterTable (dtstart added nullable, backfilled from the old task anchor, then locked)
ALTER TABLE "RecurrenceRule" ADD COLUMN     "dtstart" TIMESTAMP(3),
ADD COLUMN     "materializeTasks" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "templateEventId" TEXT,
ALTER COLUMN "taskId" DROP NOT NULL;

UPDATE "RecurrenceRule" r SET "dtstart" = COALESCE(t."dueDate", t."createdAt")
  FROM "Task" t WHERE r."taskId" = t."id";
UPDATE "RecurrenceRule" SET "dtstart" = "createdAt" WHERE "dtstart" IS NULL;
ALTER TABLE "RecurrenceRule" ALTER COLUMN "dtstart" SET NOT NULL;

-- Pre-existing rules were task-materializing by definition
UPDATE "RecurrenceRule" SET "materializeTasks" = true;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "detached" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "originalStartsAt" TIMESTAMP(3),
ADD COLUMN     "seriesId" TEXT,
ALTER COLUMN "kind" SET DEFAULT 'EVENT';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "eventId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "RecurrenceRule_templateEventId_key" ON "RecurrenceRule"("templateEventId");

-- CreateIndex
CREATE INDEX "Event_seriesId_idx" ON "Event"("seriesId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_seriesId_originalStartsAt_key" ON "Event"("seriesId", "originalStartsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_type_eventId_dueAt_key" ON "Notification"("userId", "type", "eventId", "dueAt");

-- AddForeignKey
ALTER TABLE "RecurrenceRule" ADD CONSTRAINT "RecurrenceRule_templateEventId_fkey" FOREIGN KEY ("templateEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "RecurrenceRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

