// Entry point of the demo server. `mastra dev` looks for this file in src/mastra/.
// It wires both examples into one Mastra instance:
//   incident-desk/  Example 1: workflow, supervisor, two read-only specialists, approval
//   planner/        Example 2: the same request as single agent, centralized and decentralized network
//   model/          shared: which model each agent gets (live or mock)
//   storage.ts      shared: persistence (threads, workflow snapshots, traces)
import { Mastra } from '@mastra/core/mastra';
import { MastraStorageExporter, Observability, SensitiveDataFilter } from '@mastra/observability';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { deployHistorian, logAnalyst, triageAgent } from './incident-desk/agents/specialists';
import { incidentCommander, incidentInvestigator } from './incident-desk/agents/supervisors';
import { incidentTriage } from './incident-desk/workflows/incident-triage';
import { evidenceGrounded } from './incident-desk/scorers';
import { deskRoutes } from './incident-desk/routes';
import { plannerAgents } from './planner/agents';
import { plannerRoutes } from './planner/routes';
import { demoMode, MODEL_IDS, plannerMode } from './model/models';
import { createStorage } from './storage';

// `mastra dev` runs from a build folder, scripts and tests from the project root: find the project root either way.
function projectRoot(): string {
  if (process.env.INCIDENT_DESK_ROOT) return process.env.INCIDENT_DESK_ROOT;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'ui-incident-desk', 'index.html')) && existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}
const root = projectRoot();
if (!process.env.INCIDENT_DESK_QUIET) console.info(`\n[demo] DEMO_MODE=${demoMode()}  PLANNER_MODE=${plannerMode()}  models: large=${MODEL_IDS.large} small=${MODEL_IDS.small}\n`);

export const mastra = new Mastra({
  agents: {
    // Example 1: Incident Desk
    triageAgent,
    logAnalyst,
    deployHistorian,
    incidentInvestigator,
    incidentCommander,
    // Example 2: planner network
    ...plannerAgents,
  },
  workflows: { incidentTriage },
  scorers: { evidenceGrounded },
  storage: await createStorage(root),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'agent-architecture-demo',
        exporters: [new MastraStorageExporter()], // traces show up in Studio
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
  server: {
    // HOST=0.0.0.0 in Docker, so the port is reachable from outside the container
    host: process.env.HOST ?? 'localhost',
    // the browser cannot reach 0.0.0.0: Studio must call the server at localhost (otherwise it asks for the URL in a form)
    studioHost: process.env.STUDIO_HOST ?? 'localhost',
    port: Number(process.env.PORT ?? 4111),
    // planner runs in the network modes can take minutes; the default (180 s) cut long requests off with a 504
    timeout: 15 * 60_000,
    cors: { origin: '*', allowMethods: ['*'], allowHeaders: ['*'] },
    apiRoutes: [...deskRoutes(root), ...plannerRoutes(root)],
  },
});
