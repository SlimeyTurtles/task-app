import { router, publicProcedure } from "./init";
import { areasRouter } from "./routers/areas";
import { calibrationRouter } from "./routers/calibration";
import { capacityRouter } from "./routers/capacity";
import { eventsRouter } from "./routers/events";
import { metricsRouter } from "./routers/metrics";
import { projectsRouter } from "./routers/projects";
import { recommendationsRouter } from "./routers/recommendations";
import { settingsRouter } from "./routers/settings";
import { sharingRouter } from "./routers/sharing";
import { tagsRouter } from "./routers/tags";
import { tasksRouter } from "./routers/tasks";
import { timeBlocksRouter } from "./routers/time-blocks";

export const appRouter = router({
  health: publicProcedure.query(() => ({ status: "ok" as const, time: new Date().toISOString() })),
  areas: areasRouter,
  projects: projectsRouter,
  tags: tagsRouter,
  tasks: tasksRouter,
  events: eventsRouter,
  timeBlocks: timeBlocksRouter,
  capacity: capacityRouter,
  recommendations: recommendationsRouter,
  calibration: calibrationRouter,
  metrics: metricsRouter,
  sharing: sharingRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;
