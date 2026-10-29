"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";

const Home = dynamic(() => import("@/components/home/Home"), { ssr: false });

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Home />
    </Suspense>
  );
}
