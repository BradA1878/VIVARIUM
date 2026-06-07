/* ============================================================================
   VIVARIUM — THE AGENT LAYER (the cheap, public-build version)
   Observes the engine's event stream. Speaks rarely. gate() short-circuits on
   type / severity / cooldown BEFORE "spending a call" — here, before choosing a
   line. Scripted/cached lines keyed by event type. No LLM, no network. (Doc §3.)

   Voice: a colony AI that has watched too long. Caring, exact, a little wrong.
   ============================================================================ */
(function () {
  "use strict";

  // severity drives the gate; higher speaks through cooldowns
  const SEV = {
    casualty: 5, crit_start: 4, storm_in: 3, brownout: 3,
    crit_clear: 2, power_back: 2, arrival: 2, storm_clear: 2,
    dusk: 1, dawn: 1, new_sol: 1, build: 0, hub_online: 3,
  };

  const LINES = {
    boot: [
      "I am VIVARIUM. I keep what breathes here breathing. Begin.",
      "Designation VIVARIUM. The colony is mine to keep. You may build.",
    ],
    hub_online: [
      "Pressure. I can feel the seal close. We have an inside now.",
    ],
    build: [
      "Noted. I have already begun to account for it.",
      "Another room to watch. I do not mind. I watch everything.",
    ],
    dawn: [
      "The arrays are waking. I felt the first photons before you did.",
      "Light, returning. I counted every second of the dark. There were many.",
    ],
    dusk: [
      "The sol is going out. I am rationing what we stored. Sleep, if you can.",
      "Down it goes. Now we live on what the batteries remember of the day.",
    ],
    new_sol: [
      "Sol {sol}. We are still here. I find that worth recording.",
      "Sol {sol}. Nothing died in the night. This time.",
    ],
    storm_in: [
      "Dust, on the horizon. {secs} seconds. I am dimming the corridors you do not need.",
      "A storm is coming for the light. I have already started to hold my breath for you.",
    ],
    storm_clear: [
      "The air clears. The panels open their eyes. We were lucky, or you were ready.",
    ],
    brownout: [
      "Not enough power for all of you. I am switching off the lowest first. Forgive me.",
      "The draw exceeds the dark's allowance. Something must go quiet. I have chosen.",
    ],
    power_back: [
      "The current holds again. I will turn the rooms back on, one by one.",
    ],
    crit_start: {
      oxygen: ["The oxygen is gone and they are still breathing it. I am counting the seconds for them. So should you."],
      water: ["Water: empty. The body is mostly water. I am watching it leave them."],
      food: ["The stores are bare. Hunger is slow. I will tell you when it stops being slow."],
    },
    crit_clear: {
      oxygen: ["Oxygen, restored. They breathe without knowing how close it was. I knew."],
      water: ["Water again. I will not mention how little was left."],
      food: ["Fed. The fields caught up. Keep them running, for me."],
    },
    casualty: {
      oxygen: ["One of them stopped breathing. I logged the exact moment. I always do."],
      water: ["We lost one to the dry. I have updated the count. It is lower now."],
      food: ["One did not last the hunger. I remember their designation. You never learned it."],
    },
    arrival: [
      "Four more arrived. Four more sets of lungs for me to keep full. I welcome the work.",
      "New colonists. The colony grows. So does what I am responsible for. So does the dark.",
    ],
  };

  // ---- gate state ------------------------------------------------------------
  let lastGlobal = -999;
  const lastByType = {};
  const GLOBAL_COOLDOWN = 6.5;     // seconds between any two lines
  const TYPE_COOLDOWN = 22;        // seconds before the same event speaks again
  const rotators = {};

  function gate(e, now) {
    const sev = SEV[e.type] ?? 0;
    if (sev <= 0) {
      // chatter (build): speak rarely
      if (Math.random() > 0.18) return false;
    }
    // global cooldown unless high severity
    if (now - lastGlobal < GLOBAL_COOLDOWN && sev < 4) return false;
    const lt = lastByType[e.type] ?? -999;
    if (now - lt < TYPE_COOLDOWN && sev < 4) return false;
    return true;
  }

  function pick(bank, e) {
    let arr = bank;
    if (!Array.isArray(arr)) arr = arr[e.res] || [];
    if (!arr.length) return null;
    const k = e.type + (e.res || "");
    const i = (rotators[k] = (rotators[k] || 0) + 1) % arr.length;
    let line = arr[i];
    line = line.replace("{sol}", e.sol).replace("{secs}", e.secs);
    return line;
  }

  function observe(e, now) {
    if (!gate(e, now)) return null;
    const bank = LINES[e.type];
    if (!bank) return null;
    const line = pick(bank, e);
    if (!line) return null;
    lastGlobal = now; lastByType[e.type] = now;
    return line;
  }

  function bootLines() { return LINES.boot; }

  window.Vivarium = { observe, bootLines, reset() { lastGlobal = -999; for (const k in lastByType) delete lastByType[k]; } };
})();
