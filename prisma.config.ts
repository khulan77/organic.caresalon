import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * ЭНЭ ФАЙЛЫГ ЗӨВХӨН PRISMA CLI УНШИНА (migrate, seed, studio).
 * Ажиллаж буй апп нь `lib/prisma.ts` дотор `DATABASE_URL`-ийг өөрөө уншдаг.
 *
 * Neon дээр холболт хоёр төрөлтэй:
 *   DATABASE_URL — pooled (`-pooler` гэсэн хаяг). Апп ажиллуулахад.
 *   DIRECT_URL   — pooler-гүй шууд холболт. Migration ажиллуулахад ЗААВАЛ энэ,
 *                  учир нь schema өөрчлөх үйлдэл pooler-ээр найдвартай явахгүй.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
    shadowDatabaseUrl: process.env["SHADOW_DATABASE_URL"],
  },
});
