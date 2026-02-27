import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "call",
  description: "call Carlos AI to chat about tech, life, ideas, and current projects.",
  alternates: {
    canonical: "/c",
  },
  openGraph: {
    title: "call",
    description: "call Carlos AI to chat about tech, life, ideas, and current projects.",
    url: "https://thisiscarlos.org/c",
  },
};

export default function CallLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
