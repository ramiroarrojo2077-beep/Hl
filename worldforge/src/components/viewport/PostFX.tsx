"use client";

import { Bloom, EffectComposer, SMAA, Vignette } from "@react-three/postprocessing";
import { useSettings } from "@/store/settings";

/** Postprocesamiento solo en perfiles alto y ultra (brillo de neón y faroles, antialias). */
export function PostFX() {
  const quality = useSettings((s) => s.quality);
  if (quality !== "high" && quality !== "ultra") return null;
  return (
    <EffectComposer multisampling={quality === "ultra" ? 4 : 0} enableNormalPass={false}>
      <Bloom intensity={0.55} luminanceThreshold={0.85} luminanceSmoothing={0.2} mipmapBlur />
      {quality === "ultra" ? <SMAA /> : <></>}
      <Vignette eskil={false} offset={0.25} darkness={0.45} />
    </EffectComposer>
  );
}
