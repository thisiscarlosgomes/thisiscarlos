import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "pitch me",
  description: "submit your startup pitch for review by Carlos.",
  alternates: {
    canonical: "/p",
  },
  openGraph: {
    title: "pitch me",
    description: "submit your startup pitch for review by Carlos.",
    url: "https://thisiscarlos.org/p",
  },
};

export default function PitchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
