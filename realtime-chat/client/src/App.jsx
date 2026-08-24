import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

// URL của backend Socket.IO — set trong file .env (VITE_SERVER_URL) khi deploy
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

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
        <form className="join-card" onSubmit={handleJoin}>
          <h1>Realtime Chat</h1>
          <p className={connected ? "status ok" : "status"}>
            {connected ? "● Đã kết nối server" : "○ Đang kết nối..."}
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
        <h2>Online ({onlineUsers.length})</h2>
        <ul>
          {onlineUsers.map((u, i) => (
            <li key={i}>{u}</li>
          ))}
        </ul>
      </aside>

      <main className="chat-main">
        <header className="chat-header">Realtime Chat</header>

        <div className="messages">
          {messages.map((m) =>
            m.system ? (
              <div key={m.id} className="message system">
                {m.text}
              </div>
            ) : (
              <div
                key={m.id}
                className={`message ${m.username === username ? "own" : ""}`}
              >
                <span className="message-author">{m.username}</span>
                <span className="message-text">{m.text}</span>
              </div>
            )
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="typing-indicator">
          {typingUser ? `${typingUser} đang nhập...` : "\u00A0"}
        </div>

        <form className="composer" onSubmit={handleSend}>
          <input
            placeholder="Nhập tin nhắn..."
            value={input}
            onChange={(e) => handleTyping(e.target.value)}
          />
          <button type="submit">Gửi</button>
        </form>
      </main>
    </div>
  );
}
