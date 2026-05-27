import { z } from "zod";

import { protectedProcedure, router } from "../init";
import { recalibrateUser } from "@/lib/calibration-job";

export const calibrationRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.estimateCalibration.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: [{ dimension: "asc" }, { confidence: "desc" }],
    });
  }),

  /** Manual trigger — same code path the BullMQ worker runs nightly. */
  recalibrate: protectedProcedure.mutation(async ({ ctx }) => {
    return recalibrateUser(ctx.db, ctx.session.user.id);
  }),
});
