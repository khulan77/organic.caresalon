/**
 * Жишээ (seed) өгөгдлийг цэвэрлэнэ.
 *
 * ҮЛДЭЭХ: салбарууд, админ эрхтэй хэрэглэгчид.
 * УСТГАХ: захиалга, үйлчлүүлэгч, ажилтан, үйлчилгээ, ангилал,
 *         админаас бусад бүх нэвтрэх эрх.
 *
 * Салбарыг үлдээх шалтгаан: ажилтан заавал салбартай байх ёстой
 * (Staff.branchId нь заавал утгатай), салбар нэмэх UI хараахан алга.
 * Админыг үлдээх шалтгаан: устгавал системд хэн ч орж чадахгүй болно.
 *
 * Ажиллуулах:  bun run db:clear
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL тохируулаагүй байна.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  console.log("Цэвэрлэж байна…\n");

  const adminCount = await prisma.user.count({
    where: { role: "ADMIN", isActive: true },
  });
  if (adminCount === 0) {
    throw new Error(
      "Идэвхтэй админ алга. Цэвэрлэвэл системд орох боломжгүй болно — зогсоов.",
    );
  }

  // Дараалал нь гадаад түлхүүрийн хамаарлаар тодорхойлогдоно.
  // appointment_services, staff_schedules, staff_time_offs, sessions нь
  // эцэг мөрөө устгахад Cascade-аар өөрсдөө устана.
  const appointments = await prisma.appointment.deleteMany();
  const services = await prisma.service.deleteMany();
  const categories = await prisma.serviceCategory.deleteMany();
  const clients = await prisma.client.deleteMany();
  const staff = await prisma.staff.deleteMany();
  const users = await prisma.user.deleteMany({
    where: { role: { not: "ADMIN" } },
  });
  const closures = await prisma.branchClosure.deleteMany();

  const rows: [string, number][] = [
    ["захиалга", appointments.count],
    ["үйлчилгээ", services.count],
    ["ангилал", categories.count],
    ["үйлчлүүлэгч", clients.count],
    ["ажилтан", staff.count],
    ["нэвтрэх эрх (админаас бусад)", users.count],
    ["салбарын амралтын өдөр", closures.count],
  ];
  for (const [label, count] of rows) {
    console.log(`  − ${count} ${label}`);
  }

  const branches = await prisma.branch.findMany({
    orderBy: { sortOrder: "asc" },
    select: { name: true },
  });
  const admins = await prisma.user.findMany({
    select: { name: true, phone: true },
  });

  console.log("\nҮлдсэн:");
  for (const b of branches) console.log(`  ✓ салбар — ${b.name}`);
  for (const a of admins) console.log(`  ✓ админ — ${a.name} · ${a.phone}`);
  console.log("\nЦэвэрлэлт дууслаа.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
