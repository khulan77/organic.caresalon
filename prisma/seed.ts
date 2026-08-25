import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { hashPassword } from "../lib/password";
import { localToUtc, todayKey, addDays } from "../lib/time";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/**
 * АНХААР: доорх үйлчилгээ, үнэ, ажилтны нэрс нь ТӨСӨӨЛСӨН жишээ өгөгдөл.
 * Захиалагчаас бодит жагсаалтыг авсны дараа солино.
 */

// Хуанлийн намуухан өнгөний багц
const C = {
  rose: "#c0798c",
  gold: "#c09b5c",
  forest: "#4f7355",
  sage: "#6b8f70",
  lavender: "#8b7ba8",
  blue: "#7fa2c0",
  teal: "#6ba39b",
  clay: "#c08a5e",
  mauve: "#a98598",
  stone: "#a39887",
};

const BRANCHES = [
  {
    key: "olympic",
    name: "Olympic Residence",
    address: "Улаанбаатар, Олимпийн ордон, 2 давхар",
    phone: "72728822",
    sortOrder: 1,
  },
  {
    key: "river",
    name: "River Plaza",
    address: "Улаанбаатар, River Garden, River Plaza 512A",
    phone: "72728822",
    sortOrder: 2,
  },
  {
    key: "erdenet",
    name: "Эрдэнэт · Lotus",
    address: "Эрдэнэт хот, Lotus Residence, 2 давхар",
    phone: "72728822",
    sortOrder: 3,
  },
];

const CATEGORIES = [
  {
    name: "Маникюр",
    color: C.rose,
    sortOrder: 1,
    services: [
      { name: "Маникюр", durationMin: 60, price: 25000, color: C.rose },
      { name: "Гель будалт", durationMin: 90, price: 45000, color: C.gold },
      { name: "Dazzle Dry лак", durationMin: 45, price: 40000, color: C.clay },
      { name: "Dipping Powder", durationMin: 90, price: 75000, color: C.mauve },
      { name: "Хиймэл хумс сунгалт", durationMin: 120, price: 95000, color: C.mauve },
      { name: "Лак авах", durationMin: 20, price: 10000, color: C.stone },
    ],
  },
  {
    name: "Педикюр",
    color: C.forest,
    sortOrder: 2,
    services: [
      { name: "Педикюр", durationMin: 75, price: 35000, color: C.forest },
      { name: "Гель педикюр", durationMin: 90, price: 55000, color: C.sage },
      { name: "BioSeaweed спа педикюр", durationMin: 90, price: 70000, color: C.teal },
    ],
  },
  {
    name: "Сормуус",
    color: C.lavender,
    sortOrder: 3,
    services: [
      { name: "Сормуус суулгалт", durationMin: 120, price: 80000, color: C.lavender },
      { name: "Сормуус нэмэлт (Volume)", durationMin: 150, price: 110000, color: C.lavender },
      { name: "Сормуус засвар", durationMin: 60, price: 45000, color: C.lavender },
      { name: "Сормуус мушгилт", durationMin: 60, price: 60000, color: C.lavender, salePrice: 45000, saleEnds: null },
    ],
  },
  {
    name: "Вакс",
    color: C.clay,
    sortOrder: 4,
    services: [
      { name: "Хөлний вакс", durationMin: 45, price: 45000, color: C.clay },
      // Instagram дээрх урамшуулал — 8 сарын 31 хүртэл
      { name: "Бикини вакс", durationMin: 30, price: 50000, color: C.clay, salePrice: 35000, saleEnds: "2026-08-31" },
      { name: "Суганы вакс", durationMin: 20, price: 25000, color: C.clay },
      { name: "Сахлын вакс", durationMin: 15, price: 15000, color: C.clay },
    ],
  },
  {
    name: "Арчилгаа",
    color: C.blue,
    sortOrder: 5,
    services: [
      { name: "Гар, хөлний арчилгаа", durationMin: 50, price: 40000, color: C.blue },
      { name: "Гарын спа", durationMin: 30, price: 30000, color: C.blue },
    ],
  },
];

const STAFF_BY_BRANCH: Record<
  string,
  { name: string; color: string }[]
> = {
  olympic: [
    { name: "Сарнай", color: C.rose },
    { name: "Ундрах", color: C.forest },
    { name: "Мишээл", color: C.gold },
    { name: "Ариунаа", color: C.lavender },
  ],
  river: [
    { name: "Дулмаа", color: C.teal },
    { name: "Намуун", color: C.rose },
    { name: "Оюунтуяа", color: C.blue },
  ],
  erdenet: [
    { name: "Оюунаа", color: C.mauve },
    { name: "Тэмүүлэн", color: C.sage },
  ],
};

async function main() {
  console.log("Seed эхэлж байна…");

  // Дахин ажиллуулахад цэвэрхэн эхлэхийн тулд хамаарлын дарааллаар устгана
  await prisma.appointmentService.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.packageService.deleteMany();
  await prisma.package.deleteMany();
  await prisma.staffTimeOff.deleteMany();
  await prisma.staffSchedule.deleteMany();
  await prisma.staff.deleteMany();
  await prisma.branchClosure.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.service.deleteMany();
  await prisma.serviceCategory.deleteMany();
  await prisma.client.deleteMany();
  await prisma.branch.deleteMany();

  // ─── Салбар ───
  const branches: Record<string, string> = {};
  for (const b of BRANCHES) {
    const created = await prisma.branch.create({
      data: {
        name: b.name,
        address: b.address,
        phone: b.phone,
        openMin: 600, // 10:00
        closeMin: 1140, // 19:00
        slotMin: 15,
        sortOrder: b.sortOrder,
      },
    });
    branches[b.key] = created.id;
  }
  console.log(`  ✓ ${BRANCHES.length} салбар`);

  // ─── Хэрэглэгч (админ 1 + ресепшн 3) ───
  const defaultPassword = await hashPassword("organic2026");
  await prisma.user.createMany({
    data: [
      {
        name: "Админ",
        phone: "85563793",
        passwordHash: defaultPassword,
        role: "ADMIN",
        branchId: branches.olympic,
      },
      {
        name: "Ресепшн — Olympic",
        phone: "80000001",
        passwordHash: defaultPassword,
        role: "RECEPTION",
        branchId: branches.olympic,
      },
      {
        name: "Ресепшн — River Plaza",
        phone: "80000002",
        passwordHash: defaultPassword,
        role: "RECEPTION",
        branchId: branches.river,
      },
      {
        name: "Ресепшн — Эрдэнэт",
        phone: "80000003",
        passwordHash: defaultPassword,
        role: "RECEPTION",
        branchId: branches.erdenet,
      },
    ],
  });
  console.log("  ✓ 4 хэрэглэгч (нууц үг: organic2026)");

  // ─── Ажилтан + долоо хоногийн хуваарь ───
  const staffIds: Record<string, string[]> = {};
  for (const [branchKey, members] of Object.entries(STAFF_BY_BRANCH)) {
    staffIds[branchKey] = [];
    for (const [index, member] of members.entries()) {
      const staff = await prisma.staff.create({
        data: {
          name: member.name,
          position: "Маникюрист",
          branchId: branches[branchKey],
          color: member.color,
          sortOrder: index,
          schedules: {
            create: Array.from({ length: 7 }, (_, weekday) => ({
              weekday,
              // Ням гараг амралт
              isDayOff: weekday === 0,
              startMin: 600,
              endMin: 1140,
            })),
          },
        },
      });
      staffIds[branchKey].push(staff.id);
    }
  }
  console.log(
    `  ✓ ${Object.values(staffIds).flat().length} ажилтан + долоо хоногийн хуваарь`,
  );

  // ─── Үйлчилгээ ───
  const byName = new Map<
    string,
    { id: string; name: string; durationMin: number; price: number }
  >();
  let serviceCount = 0;
  for (const cat of CATEGORIES) {
    const category = await prisma.serviceCategory.create({
      data: { name: cat.name, color: cat.color, sortOrder: cat.sortOrder },
    });
    for (const [index, s] of cat.services.entries()) {
      const service = await prisma.service.create({
        data: {
          categoryId: category.id,
          name: s.name,
          durationMin: s.durationMin,
          price: s.price,
          color: s.color,
          salePrice: "salePrice" in s ? (s.salePrice as number) : null,
          saleEndsAt:
            "saleEnds" in s && s.saleEnds
              ? localToUtc(s.saleEnds as string, 24 * 60)
              : null,
          sortOrder: index,
        },
      });
      byName.set(service.name, service);
      serviceCount++;
    }
  }
  console.log(`  ✓ ${CATEGORIES.length} ангилал, ${serviceCount} үйлчилгээ`);

  // ─── Багц ───
  const PACKAGES = [
    {
      name: "Гар хөлний иж бүрдэл",
      description: "Маникюр, педикюр хоёрыг хамтад нь",
      price: 50000,
      color: C.rose,
      services: ["Маникюр", "Педикюр"],
    },
    {
      name: "Гель иж бүрдэл",
      description: "Гар хөлийн гель будалт",
      price: 85000,
      color: C.gold,
      services: ["Гель будалт", "Гель педикюр"],
    },
    {
      name: "Гоо сайхны өдөр",
      description: "Сормуус суулгалт, маникюр, гарын спа",
      price: 115000,
      color: C.lavender,
      services: ["Сормуус суулгалт", "Маникюр", "Гарын спа"],
    },
  ];

  for (const [index, p] of PACKAGES.entries()) {
    await prisma.package.create({
      data: {
        name: p.name,
        description: p.description,
        price: p.price,
        color: p.color,
        sortOrder: index,
        items: {
          create: p.services.map((name, order) => {
            const service = byName.get(name);
            if (!service) throw new Error(`Багцын үйлчилгээ олдсонгүй: ${name}`);
            return { serviceId: service.id, sortOrder: order };
          }),
        },
      },
    });
  }
  console.log(`  ✓ ${PACKAGES.length} багц`);

  // ─── Үйлчлүүлэгч ───
  const clientSeed = [
    { name: "Б. Оюунаа", phone: "99112233", note: "Улаан өнгө дуртай" },
    { name: "Д. Хулан", phone: "88445566", note: null },
    { name: "Н. Уянга", phone: "95556677", note: "Гелд бага зэрэг харшилтай" },
    { name: "Э. Номин", phone: "94441122", note: null },
    { name: "С. Эрдэнэ", phone: "99887766", note: "Байнгын үйлчлүүлэгч" },
    { name: "Ц. Анужин", phone: "80112233", note: null },
    { name: "Б. Сэлэнгэ", phone: "96334455", note: null },
    { name: "Ө. Тэмүүлэн", phone: "99556644", note: "Хумсны хавчилтай" },
    { name: "Т. Сувдаа", phone: "94778899", note: null },
    { name: "А. Дулмаа", phone: "88991122", note: null },
    { name: "Г. Мөнхзул", phone: "95112244", note: null },
    { name: "М. Ганцэцэг", phone: "99223344", note: null },
  ];
  const clients: Record<string, string> = {};
  for (const c of clientSeed) {
    const created = await prisma.client.create({ data: c });
    clients[c.name] = created.id;
  }
  console.log(`  ✓ ${clientSeed.length} үйлчлүүлэгч`);

  // ─── Жишээ захиалга ───
  const admin = await prisma.user.findUnique({ where: { phone: "85563793" } });
  const today = todayKey();

  type Sample = {
    branch: string;
    staff: number;
    client: string;
    day: string;
    startMin: number;
    services: string[];
    status?: "BOOKED" | "CONFIRMED" | "ARRIVED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  };

  const samples: Sample[] = [
    // Olympic — өнөөдөр
    { branch: "olympic", staff: 0, client: "Б. Оюунаа", day: today, startMin: 600, services: ["Маникюр"] },
    { branch: "olympic", staff: 0, client: "Э. Номин", day: today, startMin: 690, services: ["Гель будалт"] },
    { branch: "olympic", staff: 0, client: "Т. Сувдаа", day: today, startMin: 840, services: ["Маникюр"] },
    { branch: "olympic", staff: 1, client: "Д. Хулан", day: today, startMin: 630, services: ["Педикюр"] },
    { branch: "olympic", staff: 1, client: "Ц. Анужин", day: today, startMin: 750, services: ["Гар, хөлний арчилгаа"] },
    { branch: "olympic", staff: 1, client: "Г. Мөнхзул", day: today, startMin: 900, services: ["Педикюр"] },
    { branch: "olympic", staff: 2, client: "Н. Уянга", day: today, startMin: 600, services: ["Сормуус суулгалт"] },
    { branch: "olympic", staff: 2, client: "Б. Сэлэнгэ", day: today, startMin: 780, services: ["Хөлний вакс"], status: "NO_SHOW" },
    { branch: "olympic", staff: 2, client: "А. Дулмаа", day: today, startMin: 870, services: ["Маникюр"], status: "CANCELLED" },
    { branch: "olympic", staff: 3, client: "С. Эрдэнэ", day: today, startMin: 660, services: ["Гель будалт"] },
    { branch: "olympic", staff: 3, client: "Ө. Тэмүүлэн", day: today, startMin: 810, services: ["Маникюр"] },
    { branch: "olympic", staff: 3, client: "М. Ганцэцэг", day: today, startMin: 960, services: ["Сормуус суулгалт"] },
    // River Plaza
    { branch: "river", staff: 0, client: "Б. Оюунаа", day: today, startMin: 660, services: ["Гель педикюр"] },
    { branch: "river", staff: 1, client: "Д. Хулан", day: today, startMin: 840, services: ["Бикини вакс"] },
    { branch: "river", staff: 2, client: "Т. Сувдаа", day: today, startMin: 720, services: ["Маникюр", "Лак авах"] },
    // Эрдэнэт
    { branch: "erdenet", staff: 0, client: "Н. Уянга", day: today, startMin: 615, services: ["Dipping Powder"] },
    { branch: "erdenet", staff: 1, client: "Э. Номин", day: today, startMin: 780, services: ["Гарын спа"] },
    // Маргааш
    { branch: "olympic", staff: 0, client: "Ц. Анужин", day: addDays(today, 1), startMin: 600, services: ["Хиймэл хумс сунгалт"] },
    { branch: "olympic", staff: 1, client: "С. Эрдэнэ", day: addDays(today, 1), startMin: 720, services: ["BioSeaweed спа педикюр"] },
    { branch: "olympic", staff: 2, client: "Г. Мөнхзул", day: addDays(today, 2), startMin: 660, services: ["Сормуус засвар"] },
  ];

  for (const s of samples) {
    const items = s.services.map((name) => {
      const service = byName.get(name);
      if (!service) throw new Error(`Үйлчилгээ олдсонгүй: ${name}`);
      return service;
    });
    const totalDuration = items.reduce((sum, i) => sum + i.durationMin, 0);
    const totalPrice = items.reduce((sum, i) => sum + i.price, 0);
    const startAt = localToUtc(s.day, s.startMin);
    const endAt = new Date(startAt.getTime() + totalDuration * 60_000);

    await prisma.appointment.create({
      data: {
        branchId: branches[s.branch],
        staffId: staffIds[s.branch][s.staff],
        clientId: clients[s.client],
        startAt,
        endAt,
        status: s.status ?? "BOOKED",
        totalPrice,
        createdById: admin?.id,
        items: {
          create: items.map((item, index) => ({
            serviceId: item.id,
            name: item.name,
            price: item.price,
            durationMin: item.durationMin,
            sortOrder: index,
          })),
        },
      },
    });
  }
  console.log(`  ✓ ${samples.length} жишээ захиалга`);

  console.log("Seed дууслаа.");
}

main()
  .catch((error) => {
    console.error("Seed амжилтгүй:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
