"use client";

import dynamic from "next/dynamic";

const LeaderboardPageClient = dynamic(() => import("./page-client"), { ssr: false });

export default function LeaderboardPage() {
  return <LeaderboardPageClient />;
}
