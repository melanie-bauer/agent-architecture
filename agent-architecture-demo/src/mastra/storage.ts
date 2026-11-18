// Persistence for both examples. Mastra brings the storage layer; we only choose where it writes.
//
//   incident-desk.db  (LibSQL = SQLite)  conversation threads and messages, and workflow snapshots.
//                                        A paused workflow (waiting for an approval) is stored here,
//                                        so nothing waits in memory and a resume works after a restart.
//   traces.duckdb     (DuckDB)           traces and metrics that Mastra Studio shows.
//
// The business data of the examples (tickets, logs, deploys, rooms, budgets) is NOT stored here.
// It lives in data.ts files as fixed fake data and stands in for external systems
// (ticket system, log store, deploy history, venue catalogue). The tools are the adapters to those systems.
import { MastraCompositeStore } from '@mastra/core/storage';
import { DuckDBStore } from '@mastra/duckdb';
import { LibSQLStore } from '@mastra/libsql';
import path from 'node:path';

export async function createStorage(root: string) {
  const dbFile = process.env.INCIDENT_DESK_DB ?? `file:${path.join(root, 'incident-desk.db')}`;
  const tracesFile = process.env.INCIDENT_DESK_TRACES ?? path.join(root, 'traces.duckdb');
  return new MastraCompositeStore({
    id: 'demo-storage',
    default: new LibSQLStore({ id: 'incident-desk', url: dbFile }),
    // LibSQL traces break the Studio trace list in @mastra/core 1.81.0, so traces go to DuckDB.
    domains: { observability: await new DuckDBStore({ path: tracesFile }).getStore('observability') },
  });
}
