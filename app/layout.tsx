import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";

// Кирилл дэмжсэн фонтууд сонгосон.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

// Гарчиг, логоны serif.
// Claude-ын Tiempos нь худалдааны фонт тул багцалж болохгүй — Source Serif 4
// нь түүнтэй хамгийн ойр, кирилл бүрэн дэмждэг үнэгүй хувилбар.
const sourceSerif = Source_Serif_4({
  variable: "--font-serif-src",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "600"],
  display: "swap",
});

// Хуанлийн цагийн тоонууд эгнээгээрээ таарахын тулд
const jetbrains = JetBrains_Mono({
  variable: "--font-mono-jet",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

/**
 * Гар утасны дэлгэцэд зөв тохирох тохиргоо.
 * `viewportFit: "cover"` нь ирмэгтэй (notch) утсанд бүтэн дэлгэцийг ашиглана;
 * доод талын аюулгүй зайг `env(safe-area-inset-*)` -ээр тооцно.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#354b3c",
};

export const metadata: Metadata = {
  title: {
    default: "Organic Care — Захиалгын самбар",
    template: "%s · Organic Care",
  },
  description:
    "Organic Care Nails & Spa — цаг захиалга, ажилтны хуваарь, үйлчлүүлэгчийн бүртгэлийн систем.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="mn"
      className={`${inter.variable} ${sourceSerif.variable} ${jetbrains.variable} h-full`}
    >
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
