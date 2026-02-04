import type { MachineDef } from "./types";

// Auto-load all JSON machine definitions in this folder.
// Add a new machine by dropping a new *.json file here.
const modules = import.meta.glob("./*.json", { eager: true });

function normalize(mod: any): MachineDef {
  return (mod?.default ?? mod) as MachineDef;
}

export const machines: MachineDef[] = Object.values(modules)
  .map(normalize)
  .sort((a, b) => a.id.localeCompare(b.id));

export const machinesById: Record<string, MachineDef> = Object.fromEntries(
  machines.map((m) => [m.id, m])
);
