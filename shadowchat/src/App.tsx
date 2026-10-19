import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

const API = "https://vurpgczypufhkflfowom.supabase.co/functions/v1/shadowchat";
type Message = { id: number; session_id: string; ciphertext: string; created_at: string; guest_sessions?: { display_name?: string } | null };
type Session = { roomId: string; sessionId: string; token: string; displayName: string; expiresAt: string };
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const fromUrl = (value: string) => value.replace(/-/g, "+").replace(/_/g, "/");
async function api(body: Record<string, unknown>) {
  const response = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", "apikey": "sb_publishable_PoCZJBLkzZhL8sgcQF_nOA_BtIM69qW" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
async function encryptMessage(text: string, keyText: string) {
  const key = await crypto.subtle.importKey("raw", unb64(fromUrl(keyText)), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  return JSON.stringify({ iv: b64(iv), data: b64(new Uint8Array(encrypted)) });
}
async function decryptMessage(payload: string, keyText: string) {
  try {
    const value = JSON.parse(payload);
    const key = await crypto.subtle.importKey("raw", unb64(fromUrl(keyText)), "AES-GCM", false, ["decrypt"]);
    const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(value.iv) }, key, unb64(value.data));
    return new TextDecoder().decode(clear);
  } catch { return "Unable to decrypt this message (check that you used the original private link)."; }
}
function readHash() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  return { code: params.get("code") || "", key: params.get("key") || "" };
}
export default function App() {
  const initial = readHash();
  const [code, setCode] = useState(initial.code);
  const [key, setKey] = useState(() => localStorage.getItem("shadowchat_key") || initial.key);
  const [name, setName] = useState(localStorage.getItem("shadowchat_name") || "");
  const [session, setSession] = useState<Session | null>(() => {
    try { const saved = localStorage.getItem("shadowchat_session"); const savedKey = localStorage.getItem("shadowchat_key"); if (saved && savedKey && localStorage.getItem("shadowchat_code") === initial.code) { return JSON.parse(saved); } } catch {}
    return null;
  });
  const [messages, setMessages] = useState<{id:number; sender:string; body:string; mine:boolean; time:string}[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [ownerToken, setOwnerToken] = useState(localStorage.getItem("shadowchat_owner") || "");
  const timeline = useRef<HTMLDivElement>(null);

  const joinWithCode = useCallback(async (roomCode: string, roomKey: string, displayName: string) => {
    const joined = await api({ action: "join", secret: roomCode, displayName: displayName || "Guest" });
    const next = { roomId: joined.roomId, sessionId: joined.sessionId, token: joined.token, displayName: joined.displayName, expiresAt: joined.expiresAt };
    localStorage.setItem("shadowchat_session", JSON.stringify(next));
    localStorage.setItem("shadowchat_key", roomKey);
    localStorage.setItem("shadowchat_code", roomCode);
    localStorage.setItem("shadowchat_name", next.displayName);
    setSession(next); setKey(roomKey); setCode(roomCode); setName(next.displayName);
    setError("");
  }, []);

  useEffect(() => {
    if (!session || !key) return;
    let alive = true;
    const load = async () => {
      try {
        const result = await api({ action: "list", token: session.token });
        const decoded = await Promise.all((result.messages as Message[]).map(async m => ({
          id: m.id, sender: m.guest_sessions?.display_name || (m.session_id === session.sessionId ? session.displayName : "Guest"),
          body: await decryptMessage(m.ciphertext, key), mine: m.session_id === session.sessionId,
          time: new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        })));
        if (alive) setMessages(decoded);
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : "Could not load messages"); }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 2500);
    return () => { alive = false; window.clearInterval(timer); };
  }, [session, key]);

  useEffect(() => { timeline.current?.scrollTo({ top: timeline.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  async function createRoom() {
    setBusy(true); setError("");
    try {
      const made = await api({ action: "create" });
      const rawKey = crypto.getRandomValues(new Uint8Array(32));
      const roomKey = b64(rawKey).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      const link = window.location.origin + window.location.pathname + "#code=" + made.secret + "&key=" + roomKey;
      localStorage.setItem("shadowchat_owner", made.ownerToken); setOwnerToken(made.ownerToken);
      setShareLink(link);
      await joinWithCode(made.secret, roomKey, name || "Owner");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create room"); }
    finally { setBusy(false); }
  }
  async function joinRoom(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const cleanCode = code.trim().toLowerCase();
      const roomKey = key.trim() || initial.key;
      if (!/^[a-f0-9]{32}$/.test(cleanCode)) throw new Error("Room code must be 32 hexadecimal characters. Use the full invite link if you have one.");
      if (!roomKey) throw new Error("A private link key is required. Ask the owner to send the full invite link.");
      await joinWithCode(cleanCode, roomKey, name.trim() || "Guest");
      const nextUrl = window.location.origin + window.location.pathname + "#code=" + cleanCode + "&key=" + roomKey;
      window.history.replaceState(null, "", nextUrl);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not join room"); }
    finally { setBusy(false); }
  }
  async function send(e: FormEvent) {
    e.preventDefault(); if (!session || !key || !draft.trim()) return;
    setBusy(true); setError("");
    try {
      const ciphertext = await encryptMessage(draft.trim(), key);
      await api({ action: "send", token: session.token, ciphertext });
      setDraft("");
      const result = await api({ action: "list", token: session.token });
      const decoded = await Promise.all((result.messages as Message[]).map(async m => ({
        id: m.id, sender: m.guest_sessions?.display_name || (m.session_id === session.sessionId ? session.displayName : "Guest"),
        body: await decryptMessage(m.ciphertext, key), mine: m.session_id === session.sessionId,
        time: new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      })));
      setMessages(decoded);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send message"); }
    finally { setBusy(false); }
  }
  async function revokeRoom() {
    if (!session || !ownerToken) { setError("Only the room creator on this browser can revoke this room."); return; }
    if (!window.confirm("Revoke this room? Nobody will be able to send or read messages afterwards.")) return;
    setBusy(true);
    try { await api({ action: "revoke", token: session.token, ownerToken }); localStorage.removeItem("shadowchat_session"); localStorage.removeItem("shadowchat_key"); localStorage.removeItem("shadowchat_code"); localStorage.removeItem("shadowchat_owner"); setSession(null); setOwnerToken(""); setMessages([]); setShareLink(""); setError("Room revoked."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not revoke room"); }
    finally { setBusy(false); }
  }
  function leave() {
    localStorage.removeItem("shadowchat_session"); localStorage.removeItem("shadowchat_key");
    setSession(null); setMessages([]); setShareLink(""); setError("");
  }
  return <main className="guest-app">
    <header className="guest-header"><a className="brand" href="#"><span className="brand-mark">S</span><span>shadow<span className="brand-light">chat</span></span></a><span className="top-status"><i className={session ? "status-dot online" : "status-dot"}/>{session ? "Private room connected" : "Share a code. Keep it private."}</span></header>
    {!session ? <section className="guest-welcome"><div className="guest-hero"><div className="eyebrow">PRIVATE CONVERSATIONS, SIMPLE ACCESS</div><h1>Talk freely.<br/><em>Keep it yours.</em></h1><p className="intro">Create a private room and share one link. No Matrix account required. Messages are encrypted in your browser before they reach the server.</p><div className="feature-row"><div><span className="feature-icon">◇</span><strong>Browser encryption</strong><small>AES-GCM message encryption</small></div><div><span className="feature-icon">↗</span><strong>Invite link</strong><small>Share only with trusted people</small></div></div></div>
      <div className="guest-card"><div className="card-kicker">GET STARTED</div><h2>Create a room or join one</h2><label>Your display name<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Prince" maxLength={40}/></label><button className="primary-button" disabled={busy} onClick={()=>void createRoom()}>{busy ? "Creating room…" : "＋ Create a private room"}</button><div className="guest-divider"><span>OR JOIN WITH A CODE</span></div><form onSubmit={joinRoom}><label>Room code<input value={code} onChange={e=>setCode(e.target.value)} placeholder="Paste the code or open invite link" required/></label><label>Private link key<input value={key} onChange={e=>setKey(e.target.value)} placeholder="Filled automatically from invite link" required/></label><button className="primary-button" disabled={busy}>{busy ? "Joining…" : "Join room ↗"}</button></form><p className="fine-print">Keep the full invite link secret. Anyone who has it can join and decrypt messages. This is an early-stage app, not independently security-audited.</p>{error && <p className="error-text">{error}</p>}</div>
    </section> : <section className="guest-chat"><div className="guest-chat-head"><div><div className="card-kicker">YOUR PRIVATE SPACE</div><h2>Conversation</h2><p>Signed in as <strong>{session.displayName}</strong></p></div><div className="chat-actions"><button className="outline-button" onClick={()=>{void navigator.clipboard.writeText(shareLink || (window.location.origin+window.location.pathname+"#code="+code+"&key="+key));setError("Invite link copied.");}}>Copy invite link</button>{ownerToken && <button className="outline-button danger" onClick={()=>void revokeRoom()} disabled={busy}>Revoke room</button>}<button className="outline-button" onClick={leave}>Leave</button></div></div>
      <div className="security-banner"><span>◇</span><div><strong>Encrypted in your browser</strong><small>The server stores encrypted message payloads. Keep the invite link private and use it on trusted devices.</small></div></div>
      <div className="timeline guest-timeline" ref={timeline}>{messages.length===0 ? <div className="empty-chat"><div className="empty-lock">◇</div><h3>Start the conversation.</h3><p>Share the invite link with one trusted person, then send your first message.</p></div> : messages.map(m=><div key={m.id} className={"message-row "+(m.mine?"mine":"")}><div className="message-stack">{!m.mine && <small className="sender">{m.sender}</small>}<div className="bubble">{m.body}</div><time>{m.time}</time></div></div>)}</div>
      <form className="composer guest-composer" onSubmit={send}><input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Write a private message…" autoComplete="off" aria-label="Message"/><button className="send-button" disabled={busy||!draft.trim()} aria-label="Send message">↑</button></form>{error && <p className="error-text guest-error">{error}</p>}
    </section>}
    <footer className="footer"><span>SHADOWCHAT · GUEST CHAT</span><span>Never share your private invite link publicly.</span></footer>
  </main>;
}
