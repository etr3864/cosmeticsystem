import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRoutes } from "./modules/auth/routes.js";
import { contactRoutes } from "./modules/contacts/routes.js";
import { appointmentRoutes } from "./modules/appointments/routes.js";
import { publicRoutes } from "./modules/public/routes.js";
import { settingsRoutes } from "./modules/settings/routes.js";
import { dashboardRoutes } from "./modules/dashboard/routes.js";
import { externalRoutes } from "./modules/external/routes.js";
import { handleError } from "./http/errors.js";
import { runDueJobs } from "./modules/automations/run.js";

export function createApp() {
  const app = new Hono();
  app.use("*", cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:3000", credentials: true }));
  app.onError((error, c) => handleError(error, c));
  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/auth", authRoutes);
  app.route("/contacts", contactRoutes);
  app.route("/appointments", appointmentRoutes);
  app.route("/public", publicRoutes);
  app.route("/settings", settingsRoutes);
  app.route("/dashboard", dashboardRoutes);
  app.route("/api/v1/external", externalRoutes);
  app.post("/jobs/run", async (c) => {
    if (c.req.header("x-job-secret") !== (process.env.SESSION_SECRET ?? "")) {
      return c.json({ error: { code: "unauthorized", message: "אין הרשאה" } }, 401);
    }
    await runDueJobs();
    return c.json({ ok: true });
  });
  return app;
}
