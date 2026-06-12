/* ============================================================================
   The entire tech tree is data (doc §2.1, §4.4). The engine has no idea what a
   greenhouse *is* — it runs these recipes against resource pools. Balancing is
   editing these numbers, never touching the engine.

   consumes/produces/solar are PER SECOND at full operation. priority = power-
   allocation rank; brownout sheds the LOWEST first, so farming starves before
   life support. (Doc §2.4 pass 3, §4.4.)
   ============================================================================ */
import type { BuildingDef } from "@shared/types";

export const DEFS: Record<string, BuildingDef> = {
  hub: {
    id: "hub", name: "Pressure Hub", glyph: "HUB",
    foot: [2, 2], h: 30, color: "#3a4750",
    cost: { power: 0 }, matCost: 0,
    staffing: 0, consumes: { power: 1.5 }, produces: {},
    requiresPressure: false, isHub: true, priority: 99, door: 2,
    caps: { oxygen: 30 },
    desc: "Source of pressure. Everything sealed flood-fills from here.",
  },
  corridor: {
    id: "corridor", name: "Corridor", glyph: "===",
    foot: [1, 1], h: 10, color: "#2c363d",
    cost: { power: 0 }, matCost: 2,
    staffing: 0, consumes: { power: 0.2 }, produces: {},
    requiresPressure: false, conduit: true, priority: 95,
    desc: "Pressurized link. Carries the seal between hub and habs.",
  },
  hab: {
    id: "hab", name: "Habitat", glyph: "HAB",
    foot: [1, 1], h: 22, color: "#39444c",
    cost: { power: 0 }, matCost: 24,
    staffing: 0, consumes: { power: 1.0 }, produces: {},
    requiresPressure: true, priority: 88, popCap: 4, door: 2,
    desc: "Houses 4 colonists. Heated. Must stay pressurized.",
  },
  solar: {
    id: "solar", name: "Solar Array", glyph: "PV",
    foot: [2, 2], h: 8, color: "#1d2730",
    cost: { power: 0 }, matCost: 16,
    staffing: 0, consumes: {}, produces: {}, solar: 22,
    requiresPressure: false, priority: 0,
    desc: "Power from sunlight. Follows the sol. Gutted by dust storms.",
  },
  battery: {
    id: "battery", name: "Battery Bank", glyph: "BAT",
    foot: [1, 1], h: 14, color: "#222d34",
    cost: { power: 0 }, matCost: 14,
    staffing: 0, consumes: {}, produces: {},
    requiresPressure: false, priority: 0, caps: { power: 120 },
    desc: "Stores power. The only thing between you and the dark.",
  },
  extractor: {
    id: "extractor", name: "Ice Extractor", glyph: "H2O",
    foot: [1, 1], h: 18, color: "#33403a",
    cost: { power: 0 }, matCost: 18,
    staffing: 1, consumes: { power: 5 }, produces: { water: 4 },
    requiresPressure: false, priority: 45,
    desc: "Sublimes subsurface ice. Power in, water out.",
  },
  electrolysis: {
    id: "electrolysis", name: "Electrolysis Unit", glyph: "O2",
    foot: [1, 1], h: 20, color: "#2f3a44",
    cost: { power: 0 }, matCost: 22,
    staffing: 1, consumes: { power: 7, water: 2.5 }, produces: { oxygen: 5 },
    requiresPressure: true, priority: 82, door: 2,
    desc: "Splits water for breathable oxygen. Life support — served first.",
  },
  greenhouse: {
    id: "greenhouse", name: "Hydroponics", glyph: "GRO",
    foot: [2, 2], h: 16, color: "#33422f",
    cost: { power: 0 }, matCost: 30,
    staffing: 2, consumes: { power: 6, water: 3 }, produces: { food: 5, oxygen: 2 },
    requiresPressure: true, priority: 30, door: 2,
    desc: "Food, plus a little oxygen. Needs two workers. Shed early in a brownout.",
  },
  medbay: {
    id: "medbay", name: "Med-Bay", glyph: "MED",
    foot: [1, 1], h: 18, color: "#46333b",
    cost: { power: 0 }, matCost: 26,
    staffing: 1, consumes: { power: 4 }, produces: {},
    requiresPressure: true, priority: 60, door: 2,
    desc: "Triage for strike wounds. Heals fastest at its door, under a medic.",
  },
  cistern: {
    id: "cistern", name: "Water Cistern", glyph: "CIS",
    foot: [1, 1], h: 16, color: "#2a3a40",
    cost: { power: 0 }, matCost: 16,
    staffing: 0, consumes: {}, produces: {},
    requiresPressure: false, priority: 0, caps: { water: 160 },
    desc: "Holds water. Buffers the gap between extraction and demand.",
  },
  o2tank: {
    id: "o2tank", name: "Oxygen Tank", glyph: "TNK",
    foot: [1, 1], h: 18, color: "#28363f",
    cost: { power: 0 }, matCost: 18,
    staffing: 0, consumes: {}, produces: {},
    requiresPressure: false, priority: 0, caps: { oxygen: 130 },
    desc: "Reserve oxygen. Counts down the suffocation timer for you.",
  },
  deflector: {
    id: "deflector", name: "Deflector Array", glyph: "DFL",
    foot: [1, 1], h: 20, color: "#3a2c44",
    cost: { power: 0 }, matCost: 30,
    staffing: 0, consumes: { power: 3.5 }, produces: {},
    requiresPressure: false, priority: 35,
    desc: "Wards off abductors while powered. Sheds early in a brownout — keep it lit.",
  },
  windturbine: {
    id: "windturbine", name: "Wind Turbine", glyph: "WND",
    foot: [1, 1], h: 26, color: "#2e3d49",
    cost: { power: 0 }, matCost: 28,
    staffing: 0, consumes: {}, produces: {}, wind: 9,
    requiresPressure: false, priority: 0,
    desc: "Power from moving air. Strongest at night and in dust — the panel's complement.",
  },
  geothermal: {
    id: "geothermal", name: "Geothermal Tap", glyph: "GEO",
    foot: [1, 1], h: 16, color: "#453428",
    cost: { power: 0 }, matCost: 45,
    staffing: 0, consumes: {}, produces: {}, steady: 6, needsVent: true,
    requiresPressure: false, priority: 0,
    desc: "Flat power, sol and night. Only seats on a vent — read the terrain.",
  },
  reactor: {
    id: "reactor", name: "Fission Reactor", glyph: "FIS",
    foot: [2, 2], h: 26, color: "#414433",
    cost: { power: 0 }, matCost: 120,
    staffing: 1, consumes: { water: 0.5 }, produces: { power: 20 },
    requiresPressure: false, priority: 0,
    desc: "Big, steady power. Drinks water and wants an engineer on the rods.",
  },
  printer: {
    id: "printer", name: "Materials Printer", glyph: "PRN",
    foot: [1, 1], h: 18, color: "#3f3347",
    cost: { power: 0 }, matCost: 40,
    staffing: 0, consumes: { power: 6 }, produces: {}, producesMat: 0.35,
    requiresPressure: false, priority: 15,
    desc: "Regolith in, materials out. First thing shed when power runs short.",
  },
  roverbay: {
    id: "roverbay", name: "Rover Bay", glyph: "RVR",
    foot: [2, 2], h: 14, color: "#34414d",
    cost: { power: 0 }, matCost: 60,
    staffing: 0, consumes: { power: 2.5 }, produces: {},
    requiresPressure: false, priority: 25, door: 2,
    desc: "Garage and fabrication line. Builds one drivable bulk hauler; the countdown holds while unpowered.",
  },
  roboticsbay: {
    id: "roboticsbay", name: "Robotics Bay", glyph: "BOT",
    foot: [2, 2], h: 16, color: "#423d2f",
    cost: { power: 0 }, matCost: 90,
    staffing: 1, consumes: { power: 4 }, produces: {},
    requiresPressure: false, priority: 20, door: 2,
    desc: "Prints autonomous mining robots that work the field sol and night. Wants an engineer on the line.",
  },
};

/** Palette display order (doc §4.4 table order). */
export const ORDER: string[] = [
  "hub", "corridor", "hab", "solar", "battery",
  "extractor", "electrolysis", "greenhouse", "medbay", "cistern", "o2tank", "deflector",
  "windturbine", "geothermal", "reactor", "printer", "roverbay", "roboticsbay",
];
