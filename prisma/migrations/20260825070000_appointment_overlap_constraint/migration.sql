-- Нэг ажилтанд давхцсан цаг захиалга үүсэхээс ӨГӨГДЛИЙН САНГИЙН ТҮВШИНД сэргийлнэ.
--
-- Програмын талын шалгалт (validateSlot) нь хэрэглэгчид ойлгомжтой мессеж өгдөг.
-- Гэвч хоёр ресепшн яг нэг агшинд ижил цаг захиалбал "шалгаад дараа нь бичих"
-- логик хоорондоо уралдаж давхардал үүсгэж болно. Энэ хязгаарлалт түүнийг таслана.
--
-- Муж нь [эхлэл, төгсгөл) — 11:00-д дуусах, 11:00-д эхлэх хоёр захиалга зөрчилгүй.
-- Цуцалсан ба ирээгүй захиалга зай эзлэхгүй тул хязгаарлалтад ороогүй.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_staff_overlap"
  EXCLUDE USING gist (
    "staffId" WITH =,
    tsrange("startAt", "endAt", '[)') WITH &&
  )
  WHERE ("status" IN ('BOOKED', 'CONFIRMED', 'ARRIVED', 'COMPLETED'));
