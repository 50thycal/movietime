import type { Metadata, Viewport } from "next";
import Shell from "@/components/Shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "MovieTime",
  description: "Whose turn, what movie, what did we think.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "MovieTime", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  // Resize the layout viewport for the keyboard where it's supported, which
  // fixes this class of jumping outright. Safari ignores it, hence the
  // visualViewport handling in lib/useViewport.ts.
  interactiveWidget: "resizes-content",
  themeColor: "#0b0a0f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
