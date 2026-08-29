"use client";

import { useEffect } from "react";
import { ErrorScreen } from "@/components/error-screen";

export default function RootError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Алдаа:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col">
      <ErrorScreen error={error} retry={retry} />
    </div>
  );
}
