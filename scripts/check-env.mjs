/**
 * Deploy эхлэхийн өмнө DATABASE_URL зөв эсэхийг шалгана.
 *
 * Prisma-гийн "P1013: scheme is not recognized" алдаа нь юу буруу болохыг
 * хэлдэггүй тул энд ойлгомжтой мессеж өгнө. Нууц утгыг бүтнээр нь
 * лог руу хэвлэхгүй — зөвхөн эхний хэдэн тэмдэгтийг харуулна.
 */

const raw = process.env.DATABASE_URL;

function fail(message, hint) {
  console.error(`\n✗ DATABASE_URL алдаатай: ${message}`);
  if (hint) console.error(`  → ${hint}`);
  console.error(
    "\n  Зөв утга нь `postgres://` эсвэл `postgresql://` гэж эхэлнэ.",
  );
  console.error(
    "  Vercel → Settings → Environment Variables → DATABASE_URL хэсгийг шалгана уу.",
  );
  console.error("  Хашилт, `DATABASE_URL=` угтвар, мөр таслалт БАЙЖ БОЛОХГҮЙ.\n");
  process.exit(1);
}

if (!raw) {
  fail(
    "огт тохируулаагүй байна.",
    "Vercel дээр Production орчинд нэмсэн эсэхээ шалгана уу.",
  );
}

const trimmed = raw.trim();

if (trimmed !== raw) {
  console.warn(
    "⚠ DATABASE_URL-ийн эхэнд/төгсгөлд илүү зай эсвэл мөр таслалт байна — цэвэрлэлээ.",
  );
}

if (trimmed.startsWith("DATABASE_URL")) {
  fail(
    "утга нь `DATABASE_URL=` гэж эхэлж байна.",
    "Зөвхөн холболтын мөрийг тавина, нэрийг нь давтаж бичихгүй.",
  );
}

if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
  fail("утга хашилтаар эхэлж байна.", "Хашилтыг нь аваад зөвхөн мөрийг тавина.");
}

if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
  fail(
    "утга нь вэб хаяг байна.",
    "Prisma-гийн claim холбоосыг андуурч тавьсан байх. Тэр холбоос зөвхөн хөтөчид нээхэд зориулагдсан.",
  );
}

if (!/^postgres(ql)?:\/\//.test(trimmed)) {
  fail(
    `утга postgres:// гэж эхлэхгүй байна (эхлэл нь: "${trimmed.slice(0, 12)}…").`,
  );
}

console.log("✓ DATABASE_URL хэвийн байна.");
