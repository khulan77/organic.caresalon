-- Цагийн бүртгэл дээр ГАРААР тавих өдрийн тэмдэглэгээ.
--
-- Салонд амралтын өдөр тогтмол биш — долоо хоног бүр өөр байдаг. Тиймээс
-- долоо хоногийн үндсэн хуваарь дээр нэг өдрийн тэмдэглэгээ давхарлаж,
-- ресепшн цагийн бүртгэлээсээ шууд ажилласан / амралт / чөлөө гэж сольдог.
--
-- Тэмдэглэгээгүй өдөр урьдын адил хуваариараа бодогдоно.

CREATE TYPE "DayMarkKind" AS ENUM ('WORK', 'DAY_OFF', 'LEAVE');

CREATE TABLE "staff_day_marks" (
  "id"        TEXT NOT NULL,
  "staffId"   TEXT NOT NULL,
  "date"      DATE NOT NULL,
  "kind"      "DayMarkKind" NOT NULL,
  "note"      TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "staff_day_marks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_day_marks_staffId_date_key"
  ON "staff_day_marks" ("staffId", "date");

CREATE INDEX "staff_day_marks_date_idx" ON "staff_day_marks" ("date");

ALTER TABLE "staff_day_marks"
  ADD CONSTRAINT "staff_day_marks_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "staff"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
