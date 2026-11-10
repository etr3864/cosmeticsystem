// One-off: schedules the reminder for an appointment booked before reminders existed.
// Usage on the server, after deploy: node backend/dist/scripts/remind-once.js <appointmentId>
// It only schedules; the running backend sends it at the scheduled time.
import { prisma } from "@noa/db";
import { syncReminder } from "../modules/automations/reminder.js";

const appointmentId = process.argv[2];
if (!appointmentId) {
  console.error("usage: remind-once <appointmentId>");
  process.exit(1);
}

try {
  await syncReminder(appointmentId);
  const job = await prisma.scheduledJob.findFirst({
    where: { status: "pending", idempotencyKey: { startsWith: `reminder:${appointmentId}:` } },
  });
  console.log(job ? `reminder scheduled for ${job.runAt.toISOString()}` : "no reminder scheduled (appointment not eligible, or its reminder time already passed)");
} finally {
  await prisma.$disconnect();
}
