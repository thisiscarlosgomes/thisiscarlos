"use client";

import dynamic from "next/dynamic";

const CallPageClient = dynamic(() => import("./page-client"), { ssr: false });

export default function CallPage() {
  return <CallPageClient />;
}
