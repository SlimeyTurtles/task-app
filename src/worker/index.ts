/**
 * BullMQ worker process. Boot with `pnpm worker` (after `pnpm db:up`).
 * Picks up calibration + recurrence-materializer jobs from Redis.
 */

import "dotenv/config";
import { Queue, Worker, type Job } from "bullmq";
import { PrismaClient } from "@prisma/client";

import { recalibrateAll } from "@/lib/calibration-job";
import { materializeAll } from "@/lib/recurrence-job";
import { dispatchAll } from "@/lib/notifications-job";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6380";
const CALIBRATION_QUEUE = "calibration";
const RECURRENCE_QUEUE = "recurrence";
const NOTIFICATION_QUEUE = "notification";
const CALIBRATION_CRON = process.env.CALIBRATION_CRON ?? "0 3 * * *"; // nightly at 03:00 local
const RECURRENCE_CRON = process.env.RECURRENCE_CRON ?? "0 2 * * *"; // nightly at 02:00 local
const NOTIFICATION_CRON = process.env.NOTIFICATION_CRON ?? "*/5 * * * *"; // every 5 min

const connection = { url: REDIS_URL, maxRetriesPerRequest: null as null };
const db = new PrismaClient();

const calibrationQueue = new Queue(CALIBRATION_QUEUE, { connection });
const recurrenceQueue = new Queue(RECURRENCE_QUEUE, { connection });
const notificationQueue = new Queue(NOTIFICATION_QUEUE, { connection });

async function bootstrap() {
  await calibrationQueue.upsertJobScheduler(
    "nightly-calibration",
    { pattern: CALIBRATION_CRON },
    { name: "recalibrate-all", data: {}, opts: { removeOnComplete: 20, removeOnFail: 50 } },
  );
  await recurrenceQueue.upsertJobScheduler(
    "nightly-recurrence",
    { pattern: RECURRENCE_CRON },
    { name: "materialize-all", data: {}, opts: { removeOnComplete: 20, removeOnFail: 50 } },
  );
  await notificationQueue.upsertJobScheduler(
    "due-soon-dispatch",
    { pattern: NOTIFICATION_CRON },
    { name: "dispatch-all", data: {}, opts: { removeOnComplete: 50, removeOnFail: 100 } },
  );
  console.log(`[worker] schedulers armed: calibration=${CALIBRATION_CRON} recurrence=${RECURRENCE_CRON} notification=${NOTIFICATION_CRON}`);
}

const calibrationWorker = new Worker(
  CALIBRATION_QUEUE,
  async (job: Job) => {
    const started = Date.now();
    const { users, rowsWritten } = await recalibrateAll(db);
    const ms = Date.now() - started;
    console.log(`[worker] ${job.name} ✓ users=${users} rows=${rowsWritten} (${ms}ms)`);
    return { users, rowsWritten, ms };
  },
  { connection, concurrency: 1 },
);

const recurrenceWorker = new Worker(
  RECURRENCE_QUEUE,
  async (job: Job) => {
    const started = Date.now();
    const { rules, created } = await materializeAll(db);
    const ms = Date.now() - started;
    console.log(`[worker] ${job.name} ✓ rules=${rules} created=${created} (${ms}ms)`);
    return { rules, created, ms };
  },
  { connection, concurrency: 1 },
);

const notificationWorker = new Worker(
  NOTIFICATION_QUEUE,
  async (job: Job) => {
    const started = Date.now();
    const { users, created } = await dispatchAll(db);
    const ms = Date.now() - started;
    console.log(`[worker] ${job.name} ✓ users=${users} created=${created} (${ms}ms)`);
    return { users, created, ms };
  },
  { connection, concurrency: 1 },
);

calibrationWorker.on("failed", (job, err) => {
  console.error(`[worker:calibration] ${job?.name ?? "?"} ✗`, err);
});
recurrenceWorker.on("failed", (job, err) => {
  console.error(`[worker:recurrence] ${job?.name ?? "?"} ✗`, err);
});
notificationWorker.on("failed", (job, err) => {
  console.error(`[worker:notification] ${job?.name ?? "?"} ✗`, err);
});

async function shutdown() {
  console.log("[worker] shutting down…");
  await Promise.all([calibrationWorker.close(), recurrenceWorker.close(), notificationWorker.close()]);
  await Promise.all([calibrationQueue.close(), recurrenceQueue.close(), notificationQueue.close()]);
  await db.$disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

bootstrap().catch((err) => {
  console.error("[worker] bootstrap failed:", err);
  process.exit(1);
});
