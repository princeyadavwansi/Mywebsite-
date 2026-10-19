import { FormEvent, useEffect, useRef, useState } from "react";
import * as sdk from "matrix-js-sdk";

type ChatMessage = { id: string; sender: string; body: string; mine: boolean; time: string };
type RoomItem = { roomId: string; name: string; encrypted: boolean };
const DEFAULT_HOMESERVER = "https://matrix.org";

export default function App() {
  const [homeserver, setHomeserver] = useState(DEFAULT_HOMESERVER);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [client, setClient] = useState<sdk.MatrixClient | null>(null);
  const [userId, setUserId] = useState("");
  const [rooms, setRooms] = useState<RoomItem[]>([]);
  const [activeRoom, setActiveRoom] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [inviteId, setInviteId] = useState("");
  const [newRoomName, setNewRoomName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("Only invite people you trust.");
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!client) return;
    const refreshRooms = () => setRooms(client.getRooms().map((room) => ({
      roomId: room.roomId, name: room.name || room.roomId, encrypted: room.hasEncryptionStateEvent()
    })));
    const onEvent = (event: sdk.MatrixEvent, room?: sdk.Room) => {
      if (!room || room.roomId !== activeRoom || event.getType() !== "m.room.message") return;
      if (event.getContent()?.msgtype !== "m.text") return;
      const body = event.getContent()?.body;
      if (typeof body !== "string") return;
      const id = event.getId() || String(event.getTs()) + String(event.getSender());
      setMessages((old) => old.some((m) => m.id === id) ? old : [...old, {
        id, sender: event.getSender() || "unknown", body,
        mine: event.getSender() === client.getUserId(),
        time: new Date(event.getTs()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      }]);
      refreshRooms();
    };
    client.on(sdk.RoomEvent.Timeline, onEvent);
    refreshRooms();
    return () => { client.off(sdk.RoomEvent.Timeline, onEvent); };
  }, [client, activeRoom]);

  useEffect(() => {
    setMessages([]);
    if (!client || !activeRoom) return;
    const room = client.getRoom(activeRoom);
    if (!room) return;
    setMessages(room.getLiveTimeline().getEvents()
      .filter((event) => event.getType() === "m.room.message" && event.getContent()?.msgtype === "m.text")
      .map((event) => ({
        id: event.getId() || String(event.getTs()) + String(event.getSender()),
        sender: event.getSender() || "unknown",
        body: String(event.getContent()?.body || ""),
        mine: event.getSender() === client.getUserId(),
        time: new Date(event.getTs()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      })));
  }, [client, activeRoom]);

  useEffect(() => { timelineRef.current?.scrollTo({ top: timelineRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  async function signIn(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("Connecting…");
    try {
      const baseUrl = homeserver.trim().replace(/\/+$/, "");
      const loginClient = sdk.createClient({ baseUrl });
      const result = await loginClient.login("m.login.password", { user: username.trim(), password });
      const next = sdk.createClient({ baseUrl, accessToken: result.access_token, userId: result.user_id, deviceId: result.device_id });
      await next.initRustCrypto();
      await next.startClient({ initialSyncLimit: 30 });
      setClient(next); setUserId(result.user_id); setPassword("");
      setNotice("Connected. Verify your device identity with your contact.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Check your account and homeserver.");
      setNotice("Not connected");
    } finally { setBusy(false); }
  }

  async function createPrivateRoom(e: FormEvent) {
    e.preventDefault(); if (!client || !newRoomName.trim()) return;
    setBusy(true); setError("");
    try {
      const result = await client.createRoom({
        name: newRoomName.trim(), visibility: "private", preset: "private_chat",
        initial_state: [{ type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } }]
      });
      setNewRoomName(""); setActiveRoom(result.room_id);
      setNotice("Encrypted room created. Invite only people you trust.");
      setRooms(client.getRooms().map((r) => ({ roomId: r.roomId, name: r.name || r.roomId, encrypted: r.hasEncryptionStateEvent() })));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create encrypted room."); }
    finally { setBusy(false); }
  }

  async function inviteContact(e: FormEvent) {
    e.preventDefault(); if (!client || !activeRoom || !inviteId.trim()) return;
    setBusy(true); setError("");
    try {
      await client.invite(activeRoom, inviteId.trim()); setInviteId("");
      setNotice("Invite sent. Ask your contact to verify your device identity.");
    } catch (err) { setError(err instanceof Error ? err.message : "Invite failed. Use a Matrix ID such as @friend:matrix.org."); }
    finally { setBusy(false); }
  }

  async function sendMessage(e: FormEvent) {
    e.preventDefault(); if (!client || !activeRoom || !draft.trim()) return;
    const body = draft.trim(); setDraft("");
    try {
      await client.sendEvent(activeRoom, "m.room.message" as sdk.RoomEvent.Message, { msgtype: "m.text", body });
    } catch (err) {
      setDraft(body); setError(err instanceof Error ? err.message : "Message could not be sent.");
    }
  }

  function signOut() {
    client?.stopClient(); setClient(null); setUserId(""); setRooms([]); setMessages([]); setActiveRoom("");
    setNotice("Signed out from this page. Also revoke sessions and clear browser data on shared devices.");
  }

  const active = rooms.find((room) => room.roomId === activeRoom);
  return <main className="app-shell">
    <header className="topbar"><a className="brand" href="#"><span className="brand-mark">S</span><span>shadow<span className="brand-light">chat</span></span></a><div className="top-status"><span className={"status-dot " + (client ? "online" : "")}/>{client ? "Connected" : "Private by design"}</div></header>
    {!client ? <section className="welcome">
      <div className="hero-copy"><div className="eyebrow"><span className="mini-lock">⌑</span> YOUR SPACE. YOUR CONVERSATIONS.</div><h1>Talk freely.<br/><em>Keep it yours.</em></h1><p className="intro">A private messaging starter built on Matrix with encrypted rooms. No custom-made cryptography, no pretend security indicators.</p>
        <div className="feature-row"><div><span className="feature-icon">◇</span><strong>Encrypted rooms</strong><small>Matrix Rust crypto</small></div><div><span className="feature-icon">↗</span><strong>Invite-only</strong><small>You choose the people</small></div><div><span className="feature-icon">◉</span><strong>Open protocol</strong><small>Portable foundation</small></div></div></div>
      <form className="login-card" onSubmit={signIn}><div className="card-kicker">WELCOME BACK</div><h2>Sign in to ShadowChat</h2><p className="muted">Use an existing Matrix account on a homeserver you trust.</p>
        <label>Homeserver URL<input value={homeserver} onChange={(e) => setHomeserver(e.target.value)} type="url" required placeholder="https://matrix.org" autoComplete="url"/></label>
        <label>Username or Matrix ID<input value={username} onChange={(e) => setUsername(e.target.value)} required placeholder="@you:matrix.org" autoComplete="username"/></label>
        <label>Password<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required placeholder="Your Matrix password" autoComplete="current-password"/></label>
        <button className="primary-button" disabled={busy}>{busy ? "Connecting…" : "Connect securely"} <span>↗</span></button>
        {error && <p className="error-text">{error}</p>}<p className="fine-print">Your password is sent to the homeserver you enter. Verify its URL and trust the website origin before signing in.</p></form>
      <div className="page-note"><span>✳</span> Early-stage starter — not security audited or hack-proof.</div>
    </section> : <section className="chat-layout">
      <aside className="sidebar"><div className="sidebar-head"><div><div className="card-kicker">YOUR WORKSPACE</div><h2>Messages</h2></div><button className="icon-button" title="Sign out" onClick={signOut}>↪</button></div>
        <div className="account-chip"><div className="avatar">{userId.slice(1,2).toUpperCase() || "S"}</div><div className="account-copy"><strong>{userId}</strong><small>Matrix account</small></div><span className="secure-pill">CONNECTED</span></div>
        <form className="new-room-form" onSubmit={createPrivateRoom}><label>Create encrypted room</label><div className="inline-form"><input value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)} placeholder="Room name" required/><button aria-label="Create room" disabled={busy}>+</button></div></form>
        <div className="section-label">YOUR CONVERSATIONS <span>{rooms.length}</span></div><div className="room-list">{rooms.map((room) => <button key={room.roomId} className={"room-item " + (activeRoom === room.roomId ? "selected" : "")} onClick={() => setActiveRoom(room.roomId)}><span className="room-avatar">{room.name.slice(0,1).toUpperCase()}</span><span className="room-meta"><strong>{room.name}</strong><small>{room.encrypted ? "♢ Encrypted room" : "Room"}</small></span><span className="room-arrow">›</span></button>)}{rooms.length === 0 && <p className="empty-hint">No rooms yet. Create one to start.</p>}</div>
        <div className="sidebar-foot"><span className="green-check">✓</span> Encryption provided by Matrix SDK</div></aside>
      <section className="conversation">{activeRoom ? <>
        <div className="conversation-head"><div className="room-avatar large">{(active?.name || "C").slice(0,1).toUpperCase()}</div><div className="conversation-title"><h2>{active?.name || "Conversation"}</h2><span><i/> {active?.encrypted ? "Encrypted room" : "Encryption status unavailable"}</span></div><button className="outline-button" onClick={() => { const id = window.prompt("Friend's Matrix ID, for example @friend:matrix.org"); if (id) setInviteId(id); }}>＋ Invite</button></div>
        <div className="security-banner"><span>◇</span><div><strong>Private room</strong><small>Invite only trusted people. Verify device identities to reduce impersonation risk.</small></div></div>
        <div className="timeline" ref={timelineRef}>{messages.length === 0 ? <div className="empty-chat"><div className="empty-lock">◇</div><h3>This is your quiet space.</h3><p>Send the first message, or invite a friend with a Matrix account.</p></div> : messages.map((m) => <div className={"message-row " + (m.mine ? "mine" : "")} key={m.id}>{!m.mine && <div className="tiny-avatar">{m.sender.replace(/^@/, "").slice(0,1).toUpperCase()}</div>}<div className="message-stack">{!m.mine && <small className="sender">{m.sender}</small>}<div className="bubble">{m.body}</div><time>{m.time}</time></div></div>)}</div>
        <form className="invite-strip" onSubmit={inviteContact}><span>＋</span><input value={inviteId} onChange={(e) => setInviteId(e.target.value)} placeholder="Invite by Matrix ID: @friend:matrix.org"/><button disabled={busy || !inviteId.trim()}>Send invite</button></form>
        <form className="composer" onSubmit={sendMessage}><input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a private message…" aria-label="Message" autoComplete="off"/><span className="composer-lock" title="Encrypted room">◇</span><button className="send-button" disabled={!draft.trim() || busy} aria-label="Send message">↑</button></form>
      </> : <div className="empty-chat"><div className="empty-lock">◇</div><h3>Create your first room</h3><p>Use the left panel to create a private encrypted room.</p></div>}</section>
      {error && <div className="toast-error" role="alert">{error}<button onClick={() => setError("")}>×</button></div>}<div className="toast-notice">{notice}</div>
    </section>}
    <footer className="footer"><span>SHADOWCHAT · PRIVATE MESSAGING STARTER</span><span>Built on Matrix · Verify identities, not just icons</span></footer>
  </main>;
}