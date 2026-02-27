import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { GlobalPullRefresh } from "@/app/components/global-pull-refresh";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "Carlos",
    template: "%s | Carlos",
  },
  description: "call Carlos AI, explore current thinking, and submit your pitch.",
  metadataBase: new URL("https://thisiscarlos.org"),
  alternates: {
    canonical: "/",
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    url: "https://thisiscarlos.org",
    siteName: "Carlos",
    title: "Carlos",
    description: "call Carlos AI, explore current thinking, and submit your pitch.",
    images: [{ url: "/og", width: 1200, height: 630, alt: "Carlos" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Carlos",
    description: "call Carlos AI, explore current thinking, and submit your pitch.",
    images: ["/og"],
  },
  applicationName: "Carlos",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  appleWebApp: {
    capable: true,
    title: "Carlos",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon.png", sizes: "32x32", type: "image/png" },
      { url: "/pwa-192.png", sizes: "192x192", type: "image/png" },
      { url: "/pwa-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/icon.png",
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased lowercase`}>
        <GlobalPullRefresh />
        <Toaster position="bottom-right" />
        {children}
      </body>
    </html>
  );
}
