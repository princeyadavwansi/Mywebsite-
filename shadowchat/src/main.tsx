import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";

class AppErrorBoundary extends React.Component<{children: React.ReactNode}, {failed: boolean}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error("BotChat render error:", error); }
  render() {
    if (this.state.failed) return <main style={{fontFamily:"system-ui",padding:"32px",maxWidth:"600px",margin:"40px auto",color:"#f5f5f5",background:"#111318",borderRadius:"16px"}}>
      <h1>BotChat</h1><p>Page loading mein error aa gaya.</p><button onClick={() => window.location.reload()} style={{padding:"12px 18px",cursor:"pointer"}}>Reload page</button><p style={{fontSize:"13px",opacity:.7}}>Agar phir bhi issue ho, browser settings mein site data clear karke dobara kholo.</p>
    </main>;
    return this.props.children;
  }
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<React.StrictMode><AppErrorBoundary><App /></AppErrorBoundary></React.StrictMode>);
