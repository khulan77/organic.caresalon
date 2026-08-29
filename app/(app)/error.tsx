"use client";

import { useEffect } from "react";
import { ErrorScreen } from "@/components/error-screen";

/**
 * Аппын дотоод алдааны хил хязгаар.
 *
 * Хажуугийн цэс хэвээр үлдэж, зөвхөн агуулгын хэсэг солигдоно — ресепшн
 * шууд өөр хуудас руу үсэрч ажлаа үргэлжлүүлнэ.
 *
 * `retry()` нь өгөгдлийг ДАХИН татаад хэсгийг сэргээнэ (`reset()` нь зөвхөн
 * алдааны төлвийг цэвэрлэдэг тул сангийн түр саатлаас гарахгүй).
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Аппын алдаа:", error);
  }, [error]);

  return <ErrorScreen error={error} retry={retry} />;
}
