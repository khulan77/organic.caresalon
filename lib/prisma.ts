import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Prisma Client-ийн ганц хувилбар (singleton).
 *
 * ЗАЛХУУ (lazy) үүсгэдэг: модуль ачаалагдмагц биш, өгөгдлийн санд ҮНЭХЭЭР
 * хандах агшинд л холболт үүснэ. Ингэснээр `DATABASE_URL` тохируулаагүй үед
 * сан огт хэрэглэдэггүй хуудсууд (жишээ нь нэвтрэх хуудас) уначихгүй.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL тохируулаагүй байна. Локал дээр .env файлаа, " +
        "Vercel дээр Settings → Environment Variables хэсгээ шалгана уу.",
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

/**
 * `prisma.user.findMany()` гэх мэт хандалт бүрд доорх getClient() дуудагдана.
 * Функцүүдийг жинхэнэ client дээрээ холбож өгнө — эс бөгөөс `this` алдагдана.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient();
    const value = Reflect.get(client, property) as unknown;
    return typeof value === "function" ? value.bind(client) : value;
  },
});
