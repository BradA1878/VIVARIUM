/* ============================================================================
   The live MXF narrator call. Goes through the Anthropic SDK, server-side only —
   the provider key never reaches the client (doc §3.2). One short line, thinking
   off for low latency, tightly bounded max_tokens. Provider-swappable behind
   this single function.
   ============================================================================ */
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, userTurn } from "./prompt";

// Default to the most capable model (claude-api skill guidance); override via
// NARRATOR_MODEL to route a public build to a cheaper/faster model.
const MODEL = process.env.NARRATOR_MODEL || "claude-opus-4-8";

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic();
  return client;
}

export function liveAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** generate one VIVARIUM line for an event, or null on any failure */
export async function generateLine(event: unknown, snapshot: unknown): Promise<string | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: 120,
      // a one-liner needs no thinking; keep latency and cost down
      thinking: { type: "disabled" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userTurn(event, snapshot) }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    // collapse to a single line; strip stray quotes the model might add
    const line = text.split("\n")[0].trim().replace(/^["']|["']$/g, "");
    return line || null;
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.warn(`[narrate] model error ${err.status}: ${err.message}`);
    } else {
      console.warn("[narrate] generation failed:", err);
    }
    return null;
  }
}

export { MODEL as NARRATOR_MODEL };
