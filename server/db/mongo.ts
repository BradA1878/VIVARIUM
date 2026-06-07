/* ============================================================================
   Mongo connection — lazy, fail-fast, and optional. Save state is tiny; Mongo is
   for networking it across devices (doc §1, §5). If Mongo isn't reachable, every
   accessor returns null and the routes 503 so the client falls back to
   localStorage. The server must never crash because Mongo is down.
   ============================================================================ */
import { MongoClient, type Collection, type Document } from "mongodb";

const URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB = process.env.MONGODB_DB || "vivarium";

let client: MongoClient | null = null;
let connecting: Promise<MongoClient | null> | null = null;

async function getClient(): Promise<MongoClient | null> {
  if (client) return client;
  if (connecting) return connecting;
  connecting = (async () => {
    try {
      const c = new MongoClient(URI, { serverSelectionTimeoutMS: 1500 });
      await c.connect();
      client = c;
      return c;
    } catch (err) {
      console.warn("[mongo] unavailable — persistence falls back to localStorage:", (err as Error).message);
      connecting = null;
      return null;
    }
  })();
  return connecting;
}

export async function saves(): Promise<Collection<Document> | null> {
  const c = await getClient();
  return c ? c.db(DB).collection("saves") : null;
}

export async function mongoAvailable(): Promise<boolean> {
  return (await getClient()) !== null;
}
