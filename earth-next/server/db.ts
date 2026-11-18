/**
 * Persistencia geográfica opcional en PostgreSQL + PostGIS (DATABASE_URL).
 * Guarda lugares/colecciones compartidas con consultas espaciales por bbox y proximidad.
 * Sin DATABASE_URL la aplicación funciona igual (almacenamiento local del navegador).
 */
import pg from "pg";

let pool: pg.Pool | null = null;
let ready = false;
let initError: string | null = null;

export const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS places (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  collection  TEXT NOT NULL DEFAULT 'General' CHECK (char_length(collection) <= 100),
  note        TEXT CHECK (char_length(note) <= 2000),
  geom        GEOGRAPHY(POINT, 4326) NOT NULL,
  camera      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS places_geom_idx ON places USING GIST (geom);
CREATE INDEX IF NOT EXISTS places_collection_idx ON places (collection);
CREATE TABLE IF NOT EXISTS features (
  id          BIGSERIAL PRIMARY KEY,
  project     TEXT NOT NULL DEFAULT 'default',
  geom        GEOMETRY(GEOMETRY, 4326) NOT NULL,
  properties  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS features_geom_idx ON features USING GIST (geom);
`;

export async function initDb(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  try {
    pool = new pg.Pool({ connectionString: url, max: 5 });
    await pool.query(SCHEMA_SQL);
    ready = true;
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
    console.error("[db] PostGIS no disponible:", initError);
  }
}

export function dbReady(): boolean {
  return ready;
}

export function dbError(): string | null {
  return initError;
}

export interface PlaceRow {
  id: number;
  name: string;
  collection: string;
  note: string | null;
  lat: number;
  lon: number;
  camera: unknown;
  created_at: string;
  distance_m?: number;
}

const SELECT = `id, name, collection, note, ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lon, camera, created_at`;

export async function placesInBBox(w: number, s: number, e: number, n: number, collection?: string): Promise<PlaceRow[]> {
  const r = await pool!.query<PlaceRow>(
    `SELECT ${SELECT} FROM places WHERE ST_Intersects(geom, ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography) ${collection ? "AND collection = $5" : ""} ORDER BY created_at DESC LIMIT 1000`,
    collection ? [w, s, e, n, collection] : [w, s, e, n],
  );
  return r.rows;
}

export async function placesNear(lat: number, lon: number, radius: number): Promise<PlaceRow[]> {
  const r = await pool!.query<PlaceRow>(
    `SELECT ${SELECT}, ST_Distance(geom, ST_MakePoint($2, $1)::geography) AS distance_m FROM places
     WHERE ST_DWithin(geom, ST_MakePoint($2, $1)::geography, $3) ORDER BY distance_m LIMIT 200`,
    [lat, lon, radius],
  );
  return r.rows;
}

export async function insertPlace(p: { name: string; collection?: string; note?: string; lat: number; lon: number; camera?: unknown }): Promise<PlaceRow> {
  const r = await pool!.query<PlaceRow>(
    `INSERT INTO places (name, collection, note, geom, camera) VALUES ($1, $2, $3, ST_MakePoint($5, $4)::geography, $6) RETURNING ${SELECT}`,
    [p.name, p.collection ?? "General", p.note ?? null, p.lat, p.lon, p.camera ? JSON.stringify(p.camera) : null],
  );
  return r.rows[0]!;
}

export async function deletePlace(id: number): Promise<boolean> {
  const r = await pool!.query(`DELETE FROM places WHERE id = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}

export async function insertFeatures(project: string, fc: { features: { geometry: unknown; properties?: unknown }[] }): Promise<number> {
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    let n = 0;
    for (const f of fc.features.slice(0, 5000)) {
      await client.query(`INSERT INTO features (project, geom, properties) VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), $3)`, [project, JSON.stringify(f.geometry), JSON.stringify(f.properties ?? {})]);
      n++;
    }
    await client.query("COMMIT");
    return n;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function featuresInBBox(project: string, w: number, s: number, e: number, n: number): Promise<unknown> {
  const r = await pool!.query<{ fc: unknown }>(
    `SELECT json_build_object('type','FeatureCollection','features', coalesce(json_agg(json_build_object('type','Feature','id',id,'geometry',ST_AsGeoJSON(geom)::json,'properties',properties)), '[]'::json)) AS fc
     FROM features WHERE project = $1 AND geom && ST_MakeEnvelope($2, $3, $4, $5, 4326)`,
    [project, w, s, e, n],
  );
  return r.rows[0]?.fc;
}
