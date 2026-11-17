import type { Metadata } from "next";
import "./globals.css";
import "@/domain/domain.css";
import "@/components/ui/ui.css";
import { MotionProbe } from "@/components/MotionProbe";
import { UiGuard } from "@/components/UiGuard";
import { Reveal } from "@/components/Reveal";
import { ui } from "@/domain/ui";
import { FONT_ORIGINS, FONT_STYLESHEET } from "@/config/app";
import { LOCALE } from "@/config/locale";

export const metadata: Metadata = { title: ui.title, description: ui.description };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={LOCALE.split("-")[0]}>
      <head>
        <link rel="preconnect" href={FONT_ORIGINS[0]} />
        <link rel="preconnect" href={FONT_ORIGINS[1]} crossOrigin="" />
        <link rel="stylesheet" href={FONT_STYLESHEET} />
      </head>
      <body>
        <h1 className="ap-sr">{ui.title}</h1>
        {children}
        <Reveal />
        {process.env.NODE_ENV !== "production" && <><UiGuard /><MotionProbe /></>}
      </body>
    </html>
  );
}
