"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";

const Editor = dynamic(() => import("@/components/editor/Editor"), { ssr: false });

export default function EditorPage() {
  return (
    <Suspense fallback={null}>
      <Editor />
    </Suspense>
  );
}
