import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * ЭНЭ ФАЙЛЫГ ЗӨВХӨН PRISMA CLI УНШИНА (migrate, seed, studio).
 * Ажиллаж буй апп нь `lib/prisma.ts` дотор `DATABASE_URL`-ийг өөрөө уншдаг.
 *
 * Neon дээр холболт хоёр төрөлтэй:
 *   DATABASE_URL — pooled (`-pooler` гэсэн хаяг). Апп ажиллуулахад.
 *   DIRECT_URL   — pooler-гүй шууд холболт. Migration ажиллуулахад ЗААВАЛ энэ.
 */

/**
 * Migration-д зориулж pooler-гүй хаяг гаргана.
 *
 * ЯАГААД: `prisma migrate deploy` нь `pg_advisory_lock`-оор түгжээ тавьдаг.
 * Тэр түгжээ нь СЕССИЙН хэмжээнд амьдардаг ч Neon-ы pooler (PgBouncer)
 * гүйлгээ бүрд өөр холболт өгдөг тул түгжээ алдагдаж, deploy нь
 * «P1002 — Timed out trying to acquire a postgres advisory lock» гэж унана.
 *
 * Neon дээр шууд хаяг нь pooled хаягаас `-pooler` хэсгийг хассан нь мөн.
 * DIRECT_URL тохируулаагүй (эсвэл андуурч pooled хаягийг тавьсан) байсан ч
 * deploy унахгүйн тулд энд өөрсдөө хөрвүүлж авна.
 */
function directUrl(): string | undefined {
  const raw = (process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"])?.trim();
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    if (!url.hostname.includes("-pooler")) return raw;
    url.hostname = url.hostname.replace("-pooler", "");
    // Эдгээр нь зөвхөн pooler-т хамаатай тохиргоо
    url.searchParams.delete("pgbouncer");
    url.searchParams.delete("connection_limit");
    return url.toString();
  } catch {
    // Задлаж чадаагүй бол хэвээр нь өгнө — Prisma өөрөө алдааг хэлнэ
    return raw;
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: directUrl(),
    shadowDatabaseUrl: process.env["SHADOW_DATABASE_URL"],
  },
});
