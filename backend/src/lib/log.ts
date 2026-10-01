import { prisma } from "@noa/db";

export async function logEvent(area: string, level: string, message: string, context?: unknown) {
  await prisma.systemLog.create({
    data: { area, level, message, context: context ? (context as object) : undefined },
  });
}
