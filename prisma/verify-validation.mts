/**
 * validateSlot-ийн сервер талын шалгалтыг бодит өгөгдлийн сан дээр турших.
 * Ажиллуулах:
 *   NODE_OPTIONS=--conditions=react-server npx tsx prisma/verify-validation.mts
 */
import "dotenv/config";
import { validateSlot } from "../lib/appointments";
import { prisma } from "../lib/prisma";
import { todayKey, addDays, toLocalMinutes } from "../lib/time";

let passed = 0;
let failed = 0;

function check(label: string, actual: boolean, expected: boolean, detail = "") {
  if (actual === expected) {
    console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ""}`);
    passed++;
  } else {
    console.log(`  ❌ ${label} — хүлээсэн ${expected}, гарсан ${actual}${detail ? ` (${detail})` : ""}`);
    failed++;
  }
}

const existing = await prisma.appointment.findFirstOrThrow({
  where: { status: "BOOKED" },
  include: { staff: true },
  orderBy: { startAt: "asc" },
});

const branchId = existing.branchId;
const staffId = existing.staffId;
const day = todayKey();
const busyStart = toLocalMinutes(existing.startAt);
const busyEnd = toLocalMinutes(existing.endAt);

console.log(
  `Суурь захиалга: ${existing.staff.name}, ${busyStart}–${busyEnd} минут (${day})\n`,
);

console.log("Давхцал:");
{
  const issues = await validateSlot({
    branchId, staffId, dateKey: day, startMin: busyStart, durationMin: 30,
  });
  check("Яг эхлэх цагт нь давхцуулах", issues.some((i) => i.code === "OVERLAP"), true,
    issues.find((i) => i.code === "OVERLAP")?.message);
}
{
  const issues = await validateSlot({
    branchId, staffId, dateKey: day, startMin: busyEnd - 15, durationMin: 30,
  });
  check("Сүүлийн 15 минуттай нь давхцуулах", issues.some((i) => i.code === "OVERLAP"), true);
}
{
  const issues = await validateSlot({
    branchId, staffId, dateKey: day, startMin: busyEnd, durationMin: 30,
  });
  check("Яг дуусахад нь залгах (давхцалгүй)", issues.some((i) => i.code === "OVERLAP"), false);
}
{
  const issues = await validateSlot({
    branchId, staffId, dateKey: day, startMin: busyStart - 30, durationMin: 30,
  });
  check("Эхлэхээс өмнө дуусгах (давхцалгүй)", issues.some((i) => i.code === "OVERLAP"), false);
}
{
  const issues = await validateSlot({
    branchId, staffId, dateKey: day, startMin: busyStart,
    durationMin: busyEnd - busyStart, excludeAppointmentId: existing.id,
  });
  check("Өөрийгөө үл тооцох (засварлах үед)", issues.some((i) => i.code === "OVERLAP"), false);
}

console.log("\nАжлын цаг:");
{
  const issues = await validateSlot({
    branchId, staffId, dateKey: day, startMin: 540, durationMin: 30,
  });
  check("Нээхээс өмнө (09:00)", issues.some((i) => i.code === "BRANCH_HOURS"), true,
    issues.find((i) => i.code === "BRANCH_HOURS")?.message);
}
{
  const issues = await validateSlot({
    branchId, staffId, dateKey: day, startMin: 1110, durationMin: 60,
  });
  check("Хаахаас хойш дуусах (18:30 + 60м)", issues.some((i) => i.code === "BRANCH_HOURS"), true);
}

console.log("\nАмралтын өдөр:");
{
  // Дараагийн Ням гарагийг олно (seed дээр бүх ажилтан Ням амардаг)
  let sunday = day;
  for (let i = 0; i < 7; i++) {
    const candidate = addDays(day, i);
    const [y, m, d] = candidate.split("-").map(Number);
    if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0) { sunday = candidate; break; }
  }
  const issues = await validateSlot({
    branchId, staffId, dateKey: sunday, startMin: 660, durationMin: 30,
  });
  check(`Ням гарагт захиалах (${sunday})`, issues.some((i) => i.code === "STAFF_DAY_OFF"), true,
    issues.find((i) => i.code === "STAFF_DAY_OFF")?.message);
}

console.log("\nОгноо:");
{
  const issues = await validateSlot({
    branchId, staffId, dateKey: addDays(day, -1), startMin: 660, durationMin: 30,
  });
  check("Өнгөрсөн өдөр", issues.some((i) => i.code === "PAST"), true);
}
{
  const issues = await validateSlot({
    branchId, staffId, dateKey: addDays(day, 400), startMin: 660, durationMin: 30,
  });
  check("400 хоногийн дараа", issues.some((i) => i.code === "TOO_FAR"), true);
}

console.log("\nБуруу салбар:");
{
  const otherBranch = await prisma.branch.findFirst({ where: { id: { not: branchId } } });
  const issues = await validateSlot({
    branchId: otherBranch!.id, staffId, dateKey: day, startMin: 900, durationMin: 30,
  });
  check("Ажилтан өөр салбарынх", issues.some((i) => i.code === "STAFF_BRANCH"), true,
    issues.find((i) => i.code === "STAFF_BRANCH")?.message);
}

console.log("\nЗөв тохиолдол:");
{
  // Тухайн ажилтны сул цагийг олно
  const dayAppts = await prisma.appointment.findMany({
    where: { staffId, startAt: { gte: new Date(`${day}T00:00:00Z`) } },
  });
  const latestEnd = dayAppts.reduce((max, a) => Math.max(max, toLocalMinutes(a.endAt)), 600);
  const issues = await validateSlot({
    branchId, staffId, dateKey: day, startMin: latestEnd, durationMin: 30,
  });
  check("Сул цагт зөв захиалах", issues.length === 0, true,
    issues.length ? issues.map((i) => i.message).join(" | ") : "асуудалгүй");
}

console.log(`\n${passed} тэнцсэн, ${failed} унасан`);
await prisma.$disconnect();
process.exit(failed > 0 ? 1 : 0);
