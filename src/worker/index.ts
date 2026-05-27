/**
 * BullMQ worker process. Boot with `pnpm worker` (after `pnpm db:up`).
 * Picks up calibration jobs from Redis and recomputes EstimateCalibration
 * for every user nightly.
 */

import "dotenv/config";
import { Queue, Worker, type Job } from "bullmq";
import { PrismaClient } from "@prisma/client";

import { recalibrateAll } from "@/lib/calibration-job";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6380";
const CALIBRATION_QUEUE = "calibration";
const CALIBRATION_CRON = process.env.CALIBRATION_CRON ?? "0 3 * * *"; // nightly at 03:00 local

// Let BullMQ build its own ioredis client from the URL — avoids pulling a
// second copy of ioredis into our tree that conflicts with the one BullMQ
// ships with.
const connection = { url: REDIS_URL, maxRetriesPerRequest: null as null };
const db = new PrismaClient();

const queue = new Queue(CALIBRATION_QUEUE, { connection });

async function bootstrap() {
  // Register the recurring schedule (idempotent).
  await queue.upsertJobScheduler(
    "nightly-calibration",
    { pattern: CALIBRATION_CRON },
    { name: "recalibrate-all", data: {}, opts: { removeOnComplete: 20, removeOnFail: 50 } },
  );
  console.log(`[worker] scheduler armed: ${CALIBRATION_CRON} (queue=${CALIBRATION_QUEUE})`);
}

const worker = new Worker(
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

worker.on("failed", (job, err) => {
  console.error(`[worker] ${job?.name ?? "?"} ✗`, err);
});

async function shutdown() {
  console.log("[worker] shutting down…");
  await worker.close();
  await queue.close();
  await db.$disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

bootstrap().catch((err) => {
  console.error("[worker] bootstrap failed:", err);
  process.exit(1);
});
