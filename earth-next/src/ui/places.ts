/** Favoritos, colecciones y lugares recientes del usuario (persistidos localmente). */
import { persisted } from "../state/store.ts";
import type { Place } from "../services/geocoder.ts";
import { newId } from "../geo/tour.ts";

export interface SavedPlace {
  id: string;
  name: string;
  lon: number;
  lat: number;
  height?: number;
  heading?: number;
  pitch?: number;
  note?: string;
  collection: string;
  createdAt: string;
}

export const recentPlaces = persisted<Place[]>("recent-places", []);
export const favorites = persisted<SavedPlace[]>("favorites", []);
export const collections = persisted<string[]>("collections", ["Favoritos"]);

export function addRecent(p: Place): void {
  recentPlaces.value = [p, ...recentPlaces.value.filter((x) => x.id !== p.id)].slice(0, 20);
}

export function addFavorite(p: Omit<SavedPlace, "id" | "createdAt">): SavedPlace {
  const fav: SavedPlace = { ...p, id: newId("fav"), createdAt: new Date().toISOString() };
  favorites.value = [fav, ...favorites.value];
  if (!collections.value.includes(p.collection)) collections.value = [...collections.value, p.collection];
  return fav;
}

export function removeFavorite(id: string): void {
  favorites.value = favorites.value.filter((f) => f.id !== id);
}

export function renameCollection(from: string, to: string): void {
  if (!to.trim() || from === to) return;
  collections.value = collections.value.map((c) => (c === from ? to : c));
  favorites.value = favorites.value.map((f) => (f.collection === from ? { ...f, collection: to } : f));
}

export function deleteCollection(name: string): void {
  collections.value = collections.value.filter((c) => c !== name);
  favorites.value = favorites.value.filter((f) => f.collection !== name);
}
