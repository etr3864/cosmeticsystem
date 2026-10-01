import { serve } from "@hono/node-server";
import { prisma } from "@noa/db";
import { createApp } from "./app.js";
import { assertEncryptionKey } from "./lib/crypto.js";
import { runDueJobs } from "./modules/automations/run.js";
import { pullGoogle } from "./modules/calendar/google.js";
import { recomputeAllServices } from "./modules/pipelines/service.js";
import { dayKey } from "./lib/time.js";
import { logEvent } from "./lib/log.js";

assertEncryptionKey();
void prisma.scheduledJob.updateMany({ where: { status: "running" }, data: { status: "pending" } }).catch((error) => {
  console.error("jobs reset skipped", error instanceof Error ? error.message : error);
});

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`backend listening on ${port}`);
});

let sweptDay = "";
setInterval(() => {
  void runDueJobs().catch((error) => {
    console.error("jobs skipped", error instanceof Error ? error.message : error);
  });
  void pullGoogle().catch((error) => {
    console.error("google skipped", error instanceof Error ? error.message : error);
  });
  const today = dayKey(new Date());
  if (sweptDay === today) return;
  sweptDay = today;
  void recomputeAllServices().catch((error) => {
    sweptDay = "";
    void logEvent("ops", "error", "daily status sweep failed", { error: error instanceof Error ? error.message : "failed" });
  });
}, 30_000);
