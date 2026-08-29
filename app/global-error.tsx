"use client";

import { useEffect } from "react";

/**
 * Хамгийн гүн хамгаалалт — үндсэн layout өөрөө уначихвал энэ ажиллана.
 * Энд `<html>` ба `<body>` -г өөрөө гаргах ёстой (layout ачаалагдаагүй тул).
 * Tailwind-д найдалгүй, стилийг мөрөн дотор нь бичив.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Ноцтой алдаа:", error);
  }, [error]);

  return (
    <html lang="mn">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          backgroundColor: "#e9e6e0",
          color: "#22201d",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          padding: "24px",
        }}
      >
        <div
          style={{
            maxWidth: "26rem",
            width: "100%",
            background: "#fff",
            border: "1px solid #eeebe5",
            borderRadius: "16px",
            padding: "24px",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "1.125rem", margin: "0 0 8px" }}>
            Систем түр саатлаа
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#6b675e", margin: 0 }}>
            Хуудсыг дахин ачаална уу. Асуудал давтагдвал системийн хариуцагчид
            хандана уу.
          </p>
          <button
            type="button"
            onClick={retry}
            style={{
              marginTop: "20px",
              padding: "8px 16px",
              borderRadius: "12px",
              border: "none",
              background: "#3e5a47",
              color: "#fff",
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            Дахин оролдох
          </button>
          {error.digest ? (
            <p
              style={{
                marginTop: "16px",
                fontSize: "0.6875rem",
                color: "#b8b2a6",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              Алдааны дугаар: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
