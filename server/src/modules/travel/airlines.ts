/**
 * IATA airline code → name.
 *
 * The price endpoint returns `airline: "SU"`, and a result card that says "SU"
 * instead of "Aeroflot" is measurably worse to read. Travelpayouts publishes
 * the whole table as one static file, so this is a single fetch on first use
 * held for the life of the process.
 *
 * Deliberately best-effort: if the table cannot be fetched, every lookup
 * returns the code and the screens degrade to what they would have shown
 * anyway. A missing airline *name* must never fail a price search.
 */

const TABLE_URL = 'https://api.travelpayouts.com/data/en/airlines.json';

type AirlineRow = { code: string | null; name: string | null };

let table: Map<string, string> | null = null;
/** Deduped so a burst of first requests makes one fetch, not twenty. */
let inFlight: Promise<Map<string, string>> | null = null;

async function load(): Promise<Map<string, string>> {
  const loaded = new Map<string, string>();

  try {
    const response = await fetch(TABLE_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) return loaded;

    for (const row of (await response.json()) as AirlineRow[]) {
      if (row.code && row.name) loaded.set(row.code.toUpperCase(), row.name);
    }
  } catch {
    // Best-effort, as above.
  }

  return loaded;
}

export async function airlineName(code: string): Promise<string> {
  if (!code) return code;

  if (!table) {
    inFlight ??= load().then((loaded) => {
      table = loaded;
      inFlight = null;
      return loaded;
    });

    await inFlight;
  }

  return table?.get(code.toUpperCase()) ?? code;
}

/** Testing seam — the table is process-lifetime state. */
export function resetAirlineTable(): void {
  table = null;
  inFlight = null;
}
