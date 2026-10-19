import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

const API = "https://vurpgczypufhkflfowom.supabase.co/functions/v1/shadowchat";
type Message = { id: number; session_id: string; ciphertext: string; created_at: string; guest_sessions?: { display_name?: string } | null };
type Session = { roomId: string; sessionId: string; token: string; displayName: string; expiresAt: string };
type Member = { id: string; displayName: string; lastSeenAt: string; lastReadMessageId: number | null; online: boolean };
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
async function keyFromCode(code: string) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("shadowchat-key-v1:" + code)); return b64(new Uint8Array(digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
async function hashAppPin(pin: string) { const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("botchat-device-lock-v1:" + pin)); return b64(new Uint8Array(data)); }
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
  const hostMode = new URLSearchParams(window.location.search).get("host") === "1";
  const [code, setCode] = useState(() => initial.code || "");
  const [key, setKey] = useState(() => localStorage.getItem("shadowchat_key") || initial.key);
  const [name, setName] = useState("Prince Ydv");
  // Never restore an active chat session automatically. Every visit must re-enter the room code.
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<{id:number; sender:string; body:string; mine:boolean; time:string}[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [ownerToken, setOwnerToken] = useState(localStorage.getItem("shadowchat_owner") || "");
  const [pinHash, setPinHash] = useState(localStorage.getItem("botchat_pin_hash") || "");
  const [pinInput, setPinInput] = useState("");
  const [locked, setLocked] = useState(!!localStorage.getItem("botchat_pin_hash"));
  const [pinError, setPinError] = useState("");
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
        if (alive) { setMessages(decoded); setMembers((result.members || []) as Member[]); }
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : "Could not load messages"); }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 2500);
    return () => { alive = false; window.clearInterval(timer); };
  }, [session, key]);

  useEffect(() => { timeline.current?.scrollTo({ top: timeline.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    if (!pinHash || locked) return;
    let idleTimer = 0;
    const lockNow = () => { setLocked(true); setPinInput(""); setPinError(""); };
    const resetIdle = () => { window.clearTimeout(idleTimer); idleTimer = window.setTimeout(lockNow, 60_000); };
    const onVisibility = () => { if (document.visibilityState === "hidden") lockNow(); else resetIdle(); };
    const events = ["pointerdown", "keydown", "touchstart", "mousemove"] as const;
    events.forEach(event => window.addEventListener(event, resetIdle, { passive: true }));
    document.addEventListener("visibilitychange", onVisibility);
    resetIdle();
    return () => { window.clearTimeout(idleTimer); events.forEach(event => window.removeEventListener(event, resetIdle)); document.removeEventListener("visibilitychange", onVisibility); };
  }, [pinHash, locked]);

  async function submitPin(e: FormEvent) {
    e.preventDefault(); setPinError("");
    if (!/^\d{6}$/.test(pinInput)) { setPinError("PIN exactly 6 digits ka hona chahiye."); return; }
    const candidate = await hashAppPin(pinInput);
    if (!pinHash) { localStorage.setItem("botchat_pin_hash", candidate); setPinHash(candidate); setLocked(false); setPinInput(""); return; }
    if (candidate !== pinHash) { setPinError("Wrong PIN. Dobara try karo."); setPinInput(""); return; }
    setLocked(false); setPinInput("");
  }

  async function createRoom() {
    setBusy(true); setError("");
    try {
      const made = await api({ action: "create" });
      const roomKey = await keyFromCode(made.secret);
      const link = "";
      if (made.ownerToken) { localStorage.setItem("shadowchat_owner", made.ownerToken); setOwnerToken(made.ownerToken); } else { localStorage.removeItem("shadowchat_owner"); setOwnerToken(""); }
      setShareLink(link);
      await joinWithCode(made.secret, roomKey, name || "Owner");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create room"); }
    finally { setBusy(false); }
  }
  async function joinRoom(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const cleanCode = code.trim();
      if (!/^\d{4}$/.test(cleanCode)) throw new Error("Room code exactly 4 digits ka hona chahiye.");
      const roomKey = await keyFromCode(cleanCode);
      await joinWithCode(cleanCode, roomKey, name.trim() || "Guest");
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
  async function deleteChatHistory() {
    if (!session) return;
    if (!window.confirm("Delete the entire chat history for BOTH people? This cannot be undone.")) return;
    setBusy(true); setError("");
    try {
      await api({ action: "clear", token: session.token });
      setMessages([]);
      setError("Chat history deleted for both people.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not delete chat history"); }
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
    localStorage.removeItem("shadowchat_session"); localStorage.removeItem("shadowchat_key"); localStorage.removeItem("shadowchat_code");
    setSession(null); setMessages([]); setShareLink(""); setCode(""); setKey(""); setError("");
  }
  if (!pinHash || locked) return <main className="guest-app"><header className="guest-header"><a className="brand" href="#"><span className="brand-mark">B</span><span>Bot<span className="brand-light">Chat</span></span></a><span className="top-status"><i className="status-dot"/>{pinHash ? "Chat locked" : "Device protection setup"}</span></header><section className="guest-welcome"><div className="guest-hero"><div className="eyebrow">BOTCHAT DEVICE SECURITY</div><h1>Your chats.<br/><em>Your privacy.</em></h1><p className="intro">Set a separate 6-digit app PIN. BotChat will lock when you switch away from this page or after 1 minute without activity.</p></div><form className="guest-card" onSubmit={submitPin}><div className="card-kicker">{pinHash ? "LOCKED SESSION" : "ONE-TIME SETUP"}</div><h2>{pinHash ? "Unlock BotChat" : "Create your app PIN"}</h2><label>{pinHash ? "Enter your 6-digit PIN" : "Choose a 6-digit PIN"}<input type="password" inputMode="numeric" autoComplete="off" maxLength={6} pattern="[0-9]{6}" value={pinInput} onChange={e=>setPinInput(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="6-digit PIN" required /></label><button className="primary-button" type="submit">{pinHash ? "Unlock chat" : "Set PIN and continue"}</button><p className="fine-print">PIN isi browser par save hoga. Bhoolne par browser storage clear karne se PIN reset ho sakta hai, lekin saved session bhi clear ho sakta hai.</p>{pinError && <p className="error-text">{pinError}</p>}</form></section><footer className="footer"><span>BOTCHAT · PRIVATE CHAT</span><span>Keep your phone and browser secure.</span></footer></main>;
  return <main className="guest-app">
    <header className="guest-header"><a className="brand" href="#"><span className="brand-mark">S</span><span>shadow<span className="brand-light">chat</span></span></a><span className="top-status"><i className={session ? "status-dot online" : "status-dot"}/>{session ? "Private room connected" : "Share a code. Keep it private."}</span></header>
    {!session ? <section className="guest-welcome"><div className="guest-hero"><div className="eyebrow">PRIVATE CONVERSATIONS, SIMPLE ACCESS</div><h1>Talk freely.<br/><em>Keep it yours.</em></h1><p className="intro">One shared room for people you invite. Enter the code shared by the room host to join.</p><div className="feature-row"><div><span className="feature-icon">◇</span><strong>Browser encryption</strong><small>AES-GCM message encryption</small></div><div><span className="feature-icon">#</span><strong>4-digit room code</strong><small>Enter the code to join anytime</small></div></div></div>
      <div className="guest-card"><div className="card-kicker">{hostMode ? "ROOM HOST" : "JOIN A ROOM"}</div><h2>{hostMode ? "Create your private room" : "Enter the room code"}</h2><label>Your display name<input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" maxLength={40}/></label>{hostMode ? <button className="primary-button" disabled={busy} onClick={()=>void createRoom()}>{busy ? "Creating room…" : "＋ Create a private room"}</button> : null}{!hostMode ? <form onSubmit={joinRoom}><label>4-digit room code<input value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,4))} placeholder="Enter code from room host" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" required/></label><button className="primary-button" disabled={busy}>{busy ? "Joining…" : "Join room ↗"}</button></form> : null}<p className="fine-print">{hostMode ? "Create a room, then share its 4-digit code with the other person." : "Enter the 4-digit code shared by the room host. Only share it with someone you trust."}</p>{error && <p className="error-text">{error}</p>}</div>
    </section> : <section className="guest-chat"><div className="guest-chat-head"><div><div className="card-kicker">YOUR PRIVATE SPACE</div><h2>Conversation</h2><p>Signed in as <strong>{session.displayName}</strong></p><p className="presence-line">{members.filter(m=>m.id!==session.sessionId && m.online).length > 0 ? <><i className="status-dot online"/> {members.filter(m=>m.id!==session.sessionId && m.online).map(m=>m.displayName).join(", ")} online</> : <><i className="status-dot"/> Others offline</>}</p></div><div className="chat-actions"><div className="room-code-pill">ROOM CODE <strong>{code}</strong></div><button className="outline-button" onClick={()=>{setLocked(true);setPinInput("");}}>Lock now</button>{ownerToken && <button className="outline-button danger" onClick={()=>void revokeRoom()} disabled={busy}>Revoke room</button>}<button className="outline-button danger" onClick={()=>void deleteChatHistory()} disabled={busy}>Delete chat</button><button className="outline-button" onClick={leave}>Leave</button></div></div>
      <div className="security-banner"><span>◇</span><div><strong>Encrypted in your browser</strong><small>Messages stay in chat history and are not deleted when someone reads them. Read receipts and online status update while the chat is open. A 4-digit code is weak; avoid sensitive information.</small></div></div>
      <div className="timeline guest-timeline" ref={timeline}>{messages.length===0 ? <div className="empty-chat"><div className="empty-lock">◇</div><h3>Start the conversation.</h3><p>Tell your trusted person this room code so they can join from the website.</p></div> : messages.map(m=><div key={m.id} className={"message-row "+(m.mine?"mine":"")+(hostMode?(m.mine?" host-message":" guest-message"):(m.mine?" guest-message":" host-message"))}><div className="message-stack">{!m.mine && <small className="sender">{m.sender}</small>}<div className="bubble">{m.body}</div><time>{m.time}</time>{m.mine && <small className="read-receipt">{members.some(member=>member.id!==session.sessionId && member.lastReadMessageId!==null && member.lastReadMessageId>=m.id) ? "Seen" : "Sent"}</small>}</div></div>)}</div>
      <form className="composer guest-composer" onSubmit={send}><input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Write a private message…" autoComplete="off" aria-label="Message"/><button className="send-button" disabled={busy||!draft.trim()} aria-label="Send message">↑</button></form>{error && <p className="error-text guest-error">{error}</p>}
    </section>}
    <footer className="footer"><span>BOTCHAT · PRIVATE CHAT</span><span>Only share your room code with trusted people.</span></footer>
  </main>;
}
