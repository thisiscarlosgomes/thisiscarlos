import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "voice notes",
  description: "private voice notes dashboard.",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function VoiceNotesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
