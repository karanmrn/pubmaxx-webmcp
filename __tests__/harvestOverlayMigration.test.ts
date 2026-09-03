import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATION = join(
  ROOT,
  "supabase/migrations/20260828120000_0123_harvest_venue_overlays.sql",
);
const ROLLBACK = join(
  ROOT,
  "supabase/migrations/rollback/20260828120000_0123_harvest_venue_overlays_rollback.sql",
);

type Database = {
  sql(statement: string): string;
  apply(file: string): void;
  stop(): Promise<void>;
};

function binary(name: "initdb" | "postgres" | "psql"): string | null {
  for (const candidate of [
    `/opt/homebrew/bin/${name}`,
    `/opt/homebrew/opt/postgresql@16/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/lib/postgresql/16/bin/${name}`,
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        resolve(typeof address === "object" && address ? address.port : 0),
      );
    });
    server.on("error", reject);
  });
}

async function startDatabase(): Promise<Database> {
  const initdb = binary("initdb");
  const postgres = binary("postgres");
  const psql = binary("psql");
  if (!initdb || !postgres || !psql) {
    throw new Error("PostgreSQL binaries unavailable.");
  }
  const directory = mkdtempSync(join(tmpdir(), "pubmax-harvest-0123-"));
  const port = await freePort();
  execFileSync(
    initdb,
    ["-D", directory, "--auth=trust", "--username=postgres", "--locale=C", "-E", "UTF8"],
    { stdio: "pipe" },
  );
  writeFileSync(
    join(directory, "postgresql.auto.conf"),
    `listen_addresses='127.0.0.1'\nport=${port}\nfsync=off\n`,
  );
  const server: ChildProcess = spawn(
    postgres,
    ["-D", directory, "-h", "127.0.0.1", "-p", String(port)],
    { stdio: "ignore" },
  );
  const connection = [
    "-h",
    "127.0.0.1",
    "-p",
    String(port),
    "-U",
    "postgres",
    "-d",
    "postgres",
  ];
  const stop = async (): Promise<void> => {
    if (server.exitCode === null) server.kill("SIGTERM");
    await sleep(100);
    rmSync(directory, { recursive: true, force: true });
  };
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        execFileSync(psql, [...connection, "-c", "select 1"], { stdio: "pipe" });
        break;
      } catch {
        if (attempt === 99) throw new Error("PostgreSQL did not start.");
        await sleep(100);
      }
    }
    const sql = (statement: string): string =>
      execFileSync(
        psql,
        [
          ...connection,
          "-v",
          "ON_ERROR_STOP=1",
          "-q",
          "-t",
          "-A",
          "-c",
          statement,
        ],
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      ).trim();
    const apply = (file: string): void => {
      void execFileSync(psql, [...connection, "-v", "ON_ERROR_STOP=1", "-f", file], {
        stdio: "pipe",
      });
    };
    sql(
      "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;",
    );
    apply(MIGRATION);
    return { sql, apply, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

let database: Database | null = null;
let skipReason: string | null = null;

beforeAll(async () => {
  if (process.env.PUBMAX_HARVEST_MIGRATION_NO_PG === "1") {
    skipReason = "PostgreSQL test disabled.";
    return;
  }
  try {
    database = await startDatabase();
  } catch (error) {
    skipReason = error instanceof Error ? error.message : String(error);
  }
}, 30_000);

beforeEach((context) => {
  if (skipReason) context.skip(true, skipReason);
});

afterAll(async () => {
  await database?.stop();
});

describe("0123 harvest_venue_overlays", () => {
  it("enforces overlay shape and accepts case-insensitive HTTPS", () => {
    if (!database) return;
    database.sql(`
      insert into public.harvest_venue_overlays(
        osm_id, osm_ref, website, menu_url, lore_text, lore_citations,
        lore_match_name, lore_match_town, sources
      ) values (
        'node/123', 'n123', 'HTTPS://redlion.example/', 'https://redlion.example/menu',
        'The Red Lion in Clapham has stood on the common since the eighteenth century.',
        '["https://history.example/red-lion-clapham"]'::jsonb,
        'The Red Lion', 'Clapham',
        '["https://redlion.example/"]'::jsonb
      );
    `);
    expect(
      database.sql("select osm_id || '|' || osm_ref from public.harvest_venue_overlays"),
    ).toBe("node/123|n123");
    expect(() =>
      database!.sql(
        "insert into public.harvest_venue_overlays(osm_id, osm_ref, website) values ('node/456', 'n456', 'http://unsafe.example/')",
      ),
    ).toThrow();
    expect(
      database.sql(
        "select relrowsecurity from pg_class where oid = 'public.harvest_venue_overlays'::regclass",
      ),
    ).toBe("t");
    database.apply(ROLLBACK);
    expect(database.sql("select to_regclass('public.harvest_venue_overlays')")).toBe("");
  });
});
