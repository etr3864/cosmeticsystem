import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { runDueJobs } from "./modules/automations/run.js";

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`backend listening on ${port}`);
});

setInterval(() => {
  void runDueJobs().catch((error) => {
    console.error("jobs skipped", error instanceof Error ? error.message : error);
  });
}, 30_000);
