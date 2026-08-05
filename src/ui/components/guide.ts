import { ref } from "vue";

export const GUIDE_KEY = "vivarium:field-guide:v2";
export const LEGACY_HINT_KEY = "vivarium:hinted:v1";

export type GuideStage = "food" | "power" | "mining" | "complete";

export interface GuideProgress {
  v: 2;
  stage: GuideStage;
  skipped: boolean;
  miningCargoSeen: boolean;
  miningBaseline: number | null;
}

export interface GuideSnapshot {
  buildings: readonly { defId: string; connected: boolean; online: boolean; staffed: boolean }[];
  colonists: readonly { carryAmt: number; carryKind: string | null; possessed: boolean }[];
  possessed: number | null;
  solarMul: number;
  materialsAmount: number;
}

export interface GuideObjective {
  eyebrow: string;
  title: string;
  body: string;
  hint: string;
}

type GuideStorage = Pick<Storage, "getItem" | "setItem">;

export const guideOpen = ref(false);

export function openGuide(): void {
  guideOpen.value = true;
}

export function closeGuide(): void {
  guideOpen.value = false;
}

function browserStorage(): GuideStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isStage(value: unknown): value is GuideStage {
  return value === "food" || value === "power" || value === "mining" || value === "complete";
}

export function loadGuideProgress(storage?: GuideStorage): GuideProgress | null {
  try {
    const raw = (storage ?? browserStorage())?.getItem(GUIDE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GuideProgress>;
    if (parsed.v !== 2 || !isStage(parsed.stage)) return null;
    return {
      v: 2,
      stage: parsed.stage,
      skipped: parsed.skipped === true,
      miningCargoSeen: parsed.miningCargoSeen === true,
      miningBaseline: typeof parsed.miningBaseline === "number" && Number.isFinite(parsed.miningBaseline)
        ? parsed.miningBaseline
        : null,
    };
  } catch {
    return null;
  }
}

export function saveGuideProgress(progress: GuideProgress, storage?: GuideStorage): void {
  try {
    (storage ?? browserStorage())?.setItem(GUIDE_KEY, JSON.stringify(progress));
  } catch {
    // Storage can be unavailable in private browsing. The in-memory guide still works.
  }
}

export function legacyHintSeen(storage?: Pick<Storage, "getItem">): boolean {
  try {
    return (storage ?? browserStorage())?.getItem(LEGACY_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function markLegacyHintSeen(storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? browserStorage())?.setItem(LEGACY_HINT_KEY, "1");
  } catch {
    // Contextual hints are a progressive enhancement, never a start-up blocker.
  }
}

export function guideStageComplete(
  stage: GuideStage,
  snapshot: GuideSnapshot,
  progress?: Pick<GuideProgress, "miningCargoSeen" | "miningBaseline">,
): boolean {
  if (stage === "food") {
    return snapshot.buildings.some((building) => (
      building.defId === "greenhouse" && building.connected && building.online && building.staffed
    ));
  }
  if (stage === "power") {
    return snapshot.buildings.filter((building) => building.defId === "battery").length >= 2;
  }
  if (stage === "mining") {
    const baseline = progress?.miningBaseline;
    const stillCarrying = snapshot.colonists.some((colonist) => colonist.possessed && colonist.carryAmt > 0);
    return progress?.miningCargoSeen === true
      && baseline != null
      && !stillCarrying
      && snapshot.materialsAmount > baseline;
  }
  return true;
}

export function nextGuideStage(stage: GuideStage): GuideStage {
  if (stage === "food") return "power";
  if (stage === "power") return "mining";
  return "complete";
}

export function guideObjective(
  stage: Exclude<GuideStage, "complete">,
  snapshot: GuideSnapshot,
  progress?: Pick<GuideProgress, "miningCargoSeen">,
): GuideObjective {
  if (stage === "food") {
    const greenhouse = snapshot.buildings.find((building) => building.defId === "greenhouse");
    if (greenhouse && !greenhouse.connected) {
      return {
        eyebrow: "WATCH 1 OF 3 · PRESSURE",
        title: "Seal the food loop",
        body: "Hydroponics is built, but it cannot make food without pressure. Link its door back to the Pressure Hub with a Corridor.",
        hint: "Select Corridor, then choose the two sealed doors.",
      };
    }
    if (greenhouse && greenhouse.connected && (!greenhouse.online || !greenhouse.staffed)) {
      return {
        eyebrow: "WATCH 1 OF 3 · LIFE SUPPORT",
        title: "Bring Hydroponics online",
        body: "The module is sealed, but it is not producing yet. Check that it has an available crew member, power, and enough water to run.",
        hint: "An online module shows a live status light and contributes to FOOD flow.",
      };
    }
    return {
      eyebrow: "WATCH 1 OF 3 · FOOD",
      title: "Give the colony a food source",
      body: "Place Hydroponics near the hub, then connect its sealed door. A building can exist on the surface and still be offline outside the pressure network.",
      hint: "Palette → Hydroponics → Corridor → Pressure Hub.",
    };
  }

  if (stage === "power") {
    const night = snapshot.solarMul < 0.25;
    return {
      eyebrow: "WATCH 2 OF 3 · NIGHT POWER",
      title: night ? "The sun is down — protect the reserve" : "Bank daylight for the night",
      body: night
        ? "Solar output is nearly gone. Add a second Battery Bank and avoid new loads until the reserve is climbing again."
        : "Solar arrays stop carrying the colony after dusk. Add a second Battery Bank now so daylight surplus can carry life support through the dark.",
      hint: "Watch POWER amount, capacity, and net flow in the left rail.",
    };
  }

  const carryingOre = snapshot.colonists.some((colonist) => (
    colonist.possessed && colonist.carryKind === "ore" && colonist.carryAmt > 0
  ));
  const returning = progress?.miningCargoSeen === true || carryingOre;
  if (returning) {
    return {
      eyebrow: "WATCH 3 OF 3 · DEPOT",
      title: "Return the ore to the depot",
      body: "The load is in your suit. Walk back to the illuminated collection hopper beside the hub and unload it; the MATERIALS total will rise when the transfer lands.",
      hint: "P / UNLOAD at the depot. The guide completes after the credit appears.",
    };
  }
  return {
    eyebrow: "WATCH 3 OF 3 · MATERIALS",
    title: snapshot.possessed == null ? "Take the commander onto the surface" : "Bring home a mined load",
    body: snapshot.possessed == null
      ? "Pilot the commander, walk to a glowing orange ore deposit, and collect a load. Touch controls appear on tablets; keyboard pilots can press F."
      : "Walk to a glowing orange ore deposit and use Mine. Ore becomes construction materials only after you unload it at the hub depot.",
    hint: snapshot.possessed == null
      ? "F or PILOT → move → P / MINE."
      : "P / MINE at the deposit; P / UNLOAD at the depot.",
  };
}
