import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter } from "@/server/trpc/root";
import { createTRPCContext } from "@/server/trpc/init";

function handler(req: Request) {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ headers: req.headers }),
    onError({ error, path }) {
      if (process.env.NODE_ENV === "development") {
        console.error(`[trpc] ${path ?? "<no-path>"}:`, error);
      }
    },
  });
}

export { handler as GET, handler as POST };
