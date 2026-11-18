import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { Engine } from "../engine/engine.ts";

export const EngineContext = createContext<Engine | null>(null);

export function useEngine(): Engine {
  const e = useContext(EngineContext);
  if (!e) throw new Error("Motor no disponible");
  return e;
}
