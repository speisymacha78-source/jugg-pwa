import type { MetricId, MachineOdds } from "../lib/model";

export type MachineDef = {
  id: string;                // internal id (saved in data)
  name: string;              // display name
  visibleMetrics: MetricId[]; // which metrics to show in UI
  odds: MachineOdds;         // setting(1..6) denominators table
};
