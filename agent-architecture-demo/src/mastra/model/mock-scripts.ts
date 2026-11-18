// Mock mode: which scripted behaviour each agent gets. The scripts live next to their example.
import type { MockScript } from './mock-model';
import { incidentMockScripts } from '../incident-desk/mock-scripts';
import { plannerMockScripts } from '../planner/mock-scripts';

export const mockScripts: Record<string, MockScript> = {
  default: () => ({ text: 'OK.' }),
  ...incidentMockScripts,
  ...plannerMockScripts,
};
