import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

// URL của backend Socket.IO — set trong file .env (VITE_SERVER_URL) khi deploy
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

// Sinh màu ổn định theo tên (cùng 1 tên luôn ra cùng 1 màu)
function nameToColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 62%, 52%)`;
}

function initials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Avatar({ name, size = 36 }) {
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        background: nameToColor(name || "?"),
        fontSize: size * 0.4,
      }}
    >
      {initials(name || "?")}
    </div>
  );
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
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    const s = io(SERVER_URL, { transports: ["websocket"] });
    setSocket(s);

    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));

    s.on("chat-message", (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    s.on("system-message", (text) => {
      setMessages((prev) => [
        ...prev,
        { id: `sys-${Date.now()}`, system: true, text },
      ]);
    });

    s.on("online-users", (users) => setOnlineUsers(users));

    s.on("typing", (name) => setTypingUser(name));
    s.on("stop-typing", () => setTypingUser(null));

    return () => s.disconnect();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleJoin = (e) => {
    e.preventDefault();
    if (!username.trim() || !socket) return;
    socket.emit("join", username.trim());
    setJoined(true);
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim() || !socket) return;
    socket.emit("chat-message", { text: input.trim(), username });
    socket.emit("stop-typing");
    setInput("");
  };

  const handleTyping = (value) => {
    setInput(value);
    if (!socket) return;
    socket.emit("typing", username);
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit("stop-typing");
    }, 1200);
  };

  if (!joined) {
    return (
      <div className="join-screen">
        <div className="join-glow" />
        <form className="join-card" onSubmit={handleJoin}>
          <span className="join-eyebrow">Phòng chat trực tiếp</span>
          <h1>Realtime Chat</h1>
          <p className={connected ? "status ok" : "status"}>
            <span className="status-dot" />
            {connected ? "Đã kết nối server" : "Đang kết nối..."}
          </p>
          <input
            autoFocus
            placeholder="Nhập tên của bạn"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <button type="submit" disabled={!connected}>
            Vào phòng chat
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="chat-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">Realtime Chat</div>
        <h2>Đang online — {onlineUsers.length}</h2>
        <ul>
          {onlineUsers.map((u, i) => (
            <li key={i}>
              <Avatar name={u} size={28} />
              <span>{u}</span>
              <span className="dot-online" />
            </li>
          ))}
        </ul>
      </aside>

      <main className="chat-main">
        <header className="chat-header">
          <span className="chat-header-title">Phòng chung</span>
          <span className="chat-header-sub">{onlineUsers.length} người đang online</span>
        </header>

        <div className="messages">
          {messages.map((m) =>
            m.system ? (
              <div key={m.id} className="message system">
                {m.text}
              </div>
            ) : (
              <div
                key={m.id}
                className={`message-row ${m.username === username ? "own" : ""}`}
              >
                {m.username !== username && <Avatar name={m.username} />}
                <div className="bubble">
                  {m.username !== username && (
                    <span className="message-author">{m.username}</span>
                  )}
                  <span className="message-text">{m.text}</span>
                </div>
              </div>
            )
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="typing-indicator">
          {typingUser ? (
            <span className="typing-pill">
              <span className="typing-dots">
                <i /><i /><i />
              </span>
              {typingUser} đang nhập
            </span>
          ) : (
            "\u00A0"
          )}
        </div>

        <form className="composer" onSubmit={handleSend}>
          <input
            placeholder="Nhập tin nhắn..."
            value={input}
            onChange={(e) => handleTyping(e.target.value)}
          />
          <button type="submit" disabled={!input.trim()}>
            Gửi
          </button>
        </form>
      </main>
    </div>
  );
}