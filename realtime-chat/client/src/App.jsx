import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

function nameToColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 70%, 52%)`;
}

function initials(name = "?") {
  const parts = name.trim().split(/\s+/);
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts.at(-1)[0]).toUpperCase();
}

function Avatar({ name, size = 38 }) {
  return <div className="avatar" style={{ width: size, height: size, background: nameToColor(name || "?"), fontSize: size * 0.36 }}>{initials(name)}</div>;
}

function formatTime(time) {
  if (!time) return "vừa xong";
  try {
    return new Date(time).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "vừa xong";
  }
}

export default function App() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [username, setUsername] = useState("");
  const [joined, setJoined] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUser, setTypingUser] = useState(null);
  const [uploading, setUploading] = useState(false);
  const endRef = useRef(null);
  const typingRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const s = io(SERVER_URL, { transports: ["websocket"] });
    setSocket(s);
    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    s.on("chat-history", (history) => {
      setMessages(
        (history || []).map((m) => ({
          id: m._id || `${m.username}-${m.time}`,
          username: m.username,
          text: m.text,
          imageUrl: m.imageUrl,
          time: m.time,
        }))
      );
    });
    s.on("chat-message", (msg) => setMessages((prev) => [...prev, msg]));
    s.on("system-message", (text) => setMessages((prev) => [...prev, { id: `sys-${Date.now()}`, system: true, text }]));
    s.on("online-users", setOnlineUsers);
    s.on("typing", setTypingUser);
    s.on("stop-typing", () => setTypingUser(null));
    return () => s.disconnect();
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const join = (e) => { e.preventDefault(); if (!username.trim() || !socket) return; socket.emit("join", username.trim()); setJoined(true); };
  const send = (e) => { e.preventDefault(); if (!input.trim() || !socket) return; socket.emit("chat-message", { text: input.trim(), username }); socket.emit("stop-typing"); setInput(""); };
  const type = (value) => { setInput(value); if (!socket) return; socket.emit("typing", username); clearTimeout(typingRef.current); typingRef.current = setTimeout(() => socket.emit("stop-typing"), 1200); };

  const openFilePicker = () => fileInputRef.current?.click();

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset để chọn lại cùng 1 file lần sau vẫn trigger được
    if (!file || !socket) return;

    if (file.size > 5 * 1024 * 1024) {
      alert("Ảnh quá lớn, vui lòng chọn ảnh dưới 5MB.");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch(`${SERVER_URL}/api/upload`, { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload thất bại");
      const data = await res.json();
      socket.emit("chat-message", { text: "", username, imageUrl: data.url });
    } catch (err) {
      console.error(err);
      alert("Gửi ảnh thất bại, vui lòng thử lại.");
    } finally {
      setUploading(false);
    }
  };

  if (!joined) return <div className="join-screen"><div className="aurora aurora-one" /><div className="aurora aurora-two" /><form className="join-card" onSubmit={join}><div className="brand-mark">✦</div><span className="eyebrow">Realtime workspace</span><h1>Trò chuyện<br /><em>tự nhiên hơn.</em></h1><p className="join-copy">Một không gian nhỏ để kết nối, chia sẻ và không bỏ lỡ điều quan trọng.</p><div className={`connection ${connected ? "is-connected" : ""}`}><span />{connected ? "Server đang hoạt động" : "Đang kết nối server..."}</div><label htmlFor="name">Tên hiển thị</label><input id="name" autoFocus placeholder="Ví dụ: Minh Anh" value={username} onChange={(e) => setUsername(e.target.value)} /><button type="submit" disabled={!connected || !username.trim()}>Vào phòng chat <span>→</span></button><small>Không cần tài khoản · Riêng tư · Realtime</small></form></div>;

  return <div className="chat-layout"><aside className="sidebar"><div className="sidebar-top"><div className="brand"><span className="brand-icon">✦</span><span>connect<span className="brand-dot">.</span></span></div><button className="icon-button" aria-label="Tùy chọn">•••</button></div><div className="room-card"><span className="room-avatar">#</span><div><strong>Phòng chung</strong><small>Cuộc trò chuyện mở</small></div><span className="live-dot" /></div><div className="people-heading"><span>Thành viên</span><b>{onlineUsers.length}</b></div><ul className="people-list">{onlineUsers.map((u, i) => <li key={`${u}-${i}`}><Avatar name={u} size={34} /><span>{u}{u === username && <small>Bạn</small>}</span><i /></li>)}</ul><div className="sidebar-footer"><Avatar name={username} size={38} /><div><strong>{username}</strong><small>Đang hoạt động</small></div></div></aside><main className="chat-main"><header className="chat-header"><div><div className="header-kicker"><span className="live-dot" /> LIVE ROOM</div><h2>Phòng chung</h2><p>{onlineUsers.length} người đang kết nối</p></div><div className="header-actions"><button className="header-button" aria-label="Tìm kiếm">⌕</button><button className="header-button" aria-label="Thông tin">ⓘ</button></div></header><div className="messages">{messages.length === 0 && <div className="empty-state"><div className="empty-icon">✦</div><h3>Bắt đầu cuộc trò chuyện</h3><p>Hãy gửi lời chào đầu tiên đến mọi người trong phòng.</p></div>}{messages.map((m) => m.system ? <div key={m.id} className="message system">{m.text}</div> : <div key={m.id} className={`message-row ${m.username === username ? "own" : ""}`}>{m.username !== username && <Avatar name={m.username} size={34} />}<div className="bubble">{m.username !== username && <span className="message-author">{m.username}</span>}{m.imageUrl && <img src={m.imageUrl} alt="Hình ảnh gửi trong chat" className="message-image" />}{m.text && <span className="message-text">{m.text}</span>}<span className="message-time">{formatTime(m.time)}</span></div></div>)}<div ref={endRef} /></div><div className="typing-indicator">{typingUser && typingUser !== username && <span className="typing-pill"><span className="typing-dots"><i /><i /><i /></span>{typingUser} đang nhập</span>}{uploading && <span className="typing-pill">Đang gửi ảnh...</span>}</div><form className="composer" onSubmit={send}><input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: "none" }} /><button type="button" className="attach-button" aria-label="Đính kèm" onClick={openFilePicker} disabled={uploading}>＋</button><input aria-label="Tin nhắn" placeholder="Viết tin nhắn..." value={input} onChange={(e) => type(e.target.value)} /><button className="send-button" type="submit" disabled={!input.trim()} aria-label="Gửi tin nhắn">↑</button></form></main></div>;
}