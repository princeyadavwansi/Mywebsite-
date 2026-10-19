import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: cors });
const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function hash(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return [...value].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const secretHash = (secret: string) => hash("shadowchat-room-v1:" + secret);
const tokenHash = (token: string) => hash("shadowchat-session-v1:" + token);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST required" });

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json(500, { error: "Server is not configured" });
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const body = await req.json();
    const action = String(body.action || "");
    if (action === "create") {
      const secret = randomToken(16);
      const ownerToken = randomToken();
      const { data, error } = await db.from("chat_rooms").insert({
        secret_hash: await secretHash(secret),
        owner_token_hash: await tokenHash(ownerToken),
      }).select("id").single();
      if (error) throw error;
      return json(200, { roomId: data.id, secret, ownerToken });
    }

    if (action === "join") {
      const secret = String(body.secret || "").trim().toLowerCase();
      const displayName = String(body.displayName || "Guest").trim().slice(0, 40) || "Guest";
      if (!/^[a-f0-9]{32}$/.test(secret)) return json(400, { error: "Invalid room code" });
      const { data: room, error: roomError } = await db.from("chat_rooms")
        .select("id").eq("secret_hash", await secretHash(secret)).is("revoked_at", null).maybeSingle();
      if (roomError) throw roomError;
      if (!room) return json(404, { error: "Room code not found or revoked" });
      const token = randomToken();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: session, error } = await db.from("guest_sessions").insert({
        room_id: room.id, token_hash: await tokenHash(token), display_name: displayName, expires_at: expiresAt,
      }).select("id,display_name,expires_at").single();
      if (error) throw error;
      return json(200, { roomId: room.id, sessionId: session.id, token, displayName: session.display_name, expiresAt: session.expires_at });
    }

    const token = String(body.token || "");
    if (!/^[a-f0-9]{64}$/.test(token)) return json(401, { error: "Session required" });
    const { data: session, error: sessionError } = await db.from("guest_sessions")
      .select("id,room_id,display_name,expires_at").eq("token_hash", await tokenHash(token))
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return json(401, { error: "Session expired. Join again with the room code." });
    const { data: room, error: roomError } = await db.from("chat_rooms")
      .select("id,revoked_at").eq("id", session.room_id).maybeSingle();
    if (roomError) throw roomError;
    if (!room || room.revoked_at) return json(403, { error: "This room has been revoked" });

    if (action === "list") {
      const { data, error } = await db.from("chat_messages")
        .select("id,session_id,ciphertext,created_at,guest_sessions(display_name)")
        .eq("room_id", session.room_id).order("created_at", { ascending: true }).limit(200);
      if (error) throw error;
      return json(200, { messages: data || [] });
    }
    if (action === "send") {
      const ciphertext = String(body.ciphertext || "");
      if (!ciphertext || ciphertext.length > 12000) return json(400, { error: "Message must be 1–12000 characters" });
      const { data, error } = await db.from("chat_messages").insert({
        room_id: session.room_id, session_id: session.id, ciphertext,
      }).select("id,session_id,ciphertext,created_at").single();
      if (error) throw error;
      return json(200, { message: data });
    }
    if (action === "revoke") {
      const ownerToken = String(body.ownerToken || "");
      if (!/^[a-f0-9]{64}$/.test(ownerToken)) return json(401, { error: "Owner token required" });
      const { data: ownerRoom, error } = await db.from("chat_rooms").select("id,owner_token_hash")
        .eq("id", session.room_id).maybeSingle();
      if (error) throw error;
      if (!ownerRoom || ownerRoom.owner_token_hash !== await tokenHash(ownerToken)) return json(403, { error: "Owner token is invalid" });
      const { error: revokeError } = await db.from("chat_rooms").update({ revoked_at: new Date().toISOString() }).eq("id", session.room_id);
      if (revokeError) throw revokeError;
      return json(200, { ok: true });
    }
    return json(400, { error: "Unknown action" });
  } catch (err) {
    console.error("ShadowChat function error", err);
    return json(500, { error: "Request failed. Check server logs." });
  }
});
