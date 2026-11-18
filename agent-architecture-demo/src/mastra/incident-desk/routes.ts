// HTTP surface of the Incident Desk example:
//   /desk                 the browser UI (ui-incident-desk/index.html)
//   /desk/agui-client.js  its bundled AG-UI client
//   /desk/info            live or mock, model ids, who holds which tools
//   /desk/fonts/:file     Overpass (self-hosted)
//   /agui/:agentId        AG-UI endpoint for the chat tab (see server/agui-route.ts)
//   /desk/workflow        AG-UI event stream of the incidentTriage workflow (see server/workflow-route.ts)
import { registerApiRoute } from '@mastra/core/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { demoMode, MODEL_IDS } from '../model/models';
import { aguiRoute } from './server/agui-route';
import { workflowRoute } from './server/workflow-route';
import { deskRoster } from './server/roster';

export function deskRoutes(root: string) {
  const ui = path.join(root, 'ui-incident-desk');
  return [
    aguiRoute,
    workflowRoute,
    registerApiRoute('/desk', {
      method: 'GET',
      handler: async (c) => c.html(await readFile(path.join(ui, 'index.html'), 'utf8')),
    }),
    registerApiRoute('/desk/info', {
      method: 'GET',
      handler: async (c) => c.json({ mode: demoMode(), models: MODEL_IDS, agents: await deskRoster(c.get('mastra')) }),
    }),
    registerApiRoute('/desk/agui-client.js', {
      method: 'GET',
      handler: async () =>
        new Response(await readFile(path.join(ui, 'agui-client.js'), 'utf8'), { headers: { 'Content-Type': 'text/javascript' } }),
    }),
    registerApiRoute('/desk/fonts/:file', {
      method: 'GET',
      handler: async (c) => {
        const file = c.req.param('file');
        if (!/^[\w-]+\.woff2$/.test(file)) return c.json({ error: 'not found' }, 404);
        const data = await readFile(path.join(ui, 'fonts', file)).catch(() => undefined);
        if (!data) return c.json({ error: 'not found' }, 404);
        return new Response(data, { headers: { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=86400' } });
      },
    }),
  ];
}
