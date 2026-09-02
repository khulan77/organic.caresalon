-- ДАВХАР ЗАХИАЛГА.
--
-- Мастер заримдаа нэг цагт хоёр үйлчлүүлэгч хөтөлдөг (нэг гар хатаж байхад
-- нөгөөг эхлүүлнэ). Тийм захиалгыг ресепшн зориуд тэмдэглэнэ.
--
-- Тэмдэглэсэн мөрийг давхцлын хязгаарлалтаас чөлөөлнө: хэсэгчилсэн (partial)
-- нөхцөлд ороогүй мөр индекслэгдэхгүй тул хэнтэй ч зөрчилдөхгүй. Тэмдэглээгүй
-- энгийн хоёр захиалга ХЭВЭЭР давхцаж чадахгүй — санамсаргүй давхардлаас
-- хамгаалсан хамгаалалт байрандаа үлдэнэ.

ALTER TABLE "appointments"
  ADD COLUMN "allowOverlap" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "appointments"
  DROP CONSTRAINT "appointments_no_staff_overlap";

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_staff_overlap"
  EXCLUDE USING gist (
    "staffId" WITH =,
    tsrange("startAt", "endAt", '[)') WITH &&
  )
  WHERE (
    "status" IN ('BOOKED', 'CONFIRMED', 'ARRIVED', 'COMPLETED')
    AND NOT "allowOverlap"
  );
