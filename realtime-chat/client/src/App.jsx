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

function formatCountdown(seconds) {
  if (seconds == null) return "";
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch (err) {
    console.error("Không phát được âm thanh thông báo:", err);
  }
}

export default function App() {
  // ---- Auth state ----
  const [authLoading, setAuthLoading] = useState(true); // đang khôi phục session lúc load trang
  const [user, setUser] = useState(null); // { id, email, displayName, remainingSeconds, unlimited }
  const [authView, setAuthView] = useState("login"); // "login" | "register"
  const [authForm, setAuthForm] = useState({ email: "", password: "", displayName: "" });
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // ---- Chat state ----
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUser, setTypingUser] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [timeInfo, setTimeInfo] = useState({ remainingSeconds: null, unlimited: false });
  const [limitReached, setLimitReached] = useState(false);

  const endRef = useRef(null);
  const typingRef = useRef(null);
  const fileInputRef = useRef(null);
  const usernameRef = useRef("");

  // Bước 1: lúc app khởi động, kiểm tra đã có session hợp lệ chưa (cookie httpOnly)
  useEffect(() => {
    fetch(`${SERVER_URL}/api/me`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("not authenticated");
        return res.json();
      })
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    usernameRef.current = user?.displayName || "";
  }, [user]);

  // Bước 2: chỉ mở kết nối Socket.IO khi đã xác thực xong
  useEffect(() => {
    if (!user) return;
    const s = io(SERVER_URL, { withCredentials: true, transports: ["websocket"] });
    setSocket(s);

    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", (err) => {
      // token hết hạn / không hợp lệ -> quay lại màn đăng nhập
      if (err.message === "unauthorized") setUser(null);
    });

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
    s.on("chat-message", (msg) => {
      setMessages((prev) => [...prev, msg]);
      if (msg.username !== usernameRef.current) playNotificationSound();
    });
    s.on("system-message", (text) => setMessages((prev) => [...prev, { id: `sys-${Date.now()}`, system: true, text }]));
    s.on("online-users", setOnlineUsers);
    s.on("typing", setTypingUser);
    s.on("stop-typing", () => setTypingUser(null));
    s.on("time-info", (info) => setTimeInfo(info));
    s.on("limit-reached", () => setLimitReached(true));

    return () => s.disconnect();
  }, [user]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const submitAuth = async (e) => {
    e.preventDefault();
    setAuthError("");
    setAuthSubmitting(true);
    const endpoint = authView === "login" ? "/api/login" : "/api/register";
    try {
      const res = await fetch(`${SERVER_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(authForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Có lỗi xảy ra");
      setUser(data.user);
      setAuthForm({ email: "", password: "", displayName: "" });
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthSubmitting(false);
    }
  };

  const logout = async () => {
    try {
      await fetch(`${SERVER_URL}/api/logout`, { method: "POST", credentials: "include" });
    } catch {
      // bỏ qua lỗi mạng khi logout, vẫn clear state local
    }
    socket?.disconnect();
    setSocket(null);
    setUser(null);
    setMessages([]);
    setLimitReached(false);
  };

  const send = (e) => {
    e.preventDefault();
    if (!input.trim() || !socket) return;
    socket.emit("chat-message", { text: input.trim() });
    socket.emit("stop-typing");
    setInput("");
  };

  const type = (value) => {
    setInput(value);
    if (!socket) return;
    socket.emit("typing");
    clearTimeout(typingRef.current);
    typingRef.current = setTimeout(() => socket.emit("stop-typing"), 1200);
  };

  const openFilePicker = () => fileInputRef.current?.click();

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
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
      socket.emit("chat-message", { text: "", imageUrl: data.url });
    } catch (err) {
      console.error(err);
      alert("Gửi ảnh thất bại, vui lòng thử lại.");
    } finally {
      setUploading(false);
    }
  };

  // ---- Màn hình loading khi đang khôi phục session (tránh nhấp nháy) ----
  if (authLoading) {
    return (
      <div className="join-screen">
        <div className="aurora aurora-one" />
        <div className="aurora aurora-two" />
        <div className="join-card" style={{ textAlign: "center" }}>
          <div className="brand-mark">✦</div>
          <p style={{ marginTop: 16 }}>Đang khôi phục phiên đăng nhập...</p>
        </div>
      </div>
    );
  }

  // ---- Màn hình đăng nhập / đăng ký ----
  if (!user) {
    return (
      <div className="join-screen">
        <div className="aurora aurora-one" />
        <div className="aurora aurora-two" />
        <form className="join-card" onSubmit={submitAuth}>
          <div className="brand-mark">✦</div>
          <span className="eyebrow">Realtime workspace</span>
          <h1>{authView === "login" ? "Đăng nhập" : "Tạo tài khoản"}</h1>
          <p className="join-copy">
            {authView === "login" ? "Đăng nhập để tiếp tục cuộc trò chuyện." : "Tạo tài khoản để bắt đầu chat."}
          </p>

          {authView === "register" && (
            <>
              <label htmlFor="displayName">Tên hiển thị</label>
              <input
                id="displayName"
                placeholder="Ví dụ: Minh Anh"
                value={authForm.displayName}
                onChange={(e) => setAuthForm({ ...authForm, displayName: e.target.value })}
              />
            </>
          )}

          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            placeholder="ban@example.com"
            value={authForm.email}
            onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
          />

          <label htmlFor="password">Mật khẩu</label>
          <input
            id="password"
            type="password"
            placeholder="Ít nhất 6 ký tự"
            value={authForm.password}
            onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
          />

          {authError && <p style={{ color: "#ff6b6b", fontSize: 14 }}>{authError}</p>}

          <button type="submit" disabled={authSubmitting}>
            {authSubmitting ? "Đang xử lý..." : authView === "login" ? "Đăng nhập →" : "Đăng ký →"}
          </button>

          <small style={{ cursor: "pointer" }} onClick={() => { setAuthView(authView === "login" ? "register" : "login"); setAuthError(""); }}>
            {authView === "login" ? "Chưa có tài khoản? Đăng ký" : "Đã có tài khoản? Đăng nhập"}
          </small>
        </form>
      </div>
    );
  }

  // ---- Màn hình hết giờ miễn phí ----
  if (limitReached) {
    return (
      <div className="join-screen">
        <div className="aurora aurora-one" />
        <div className="aurora aurora-two" />
        <div className="join-card" style={{ textAlign: "center" }}>
          <div className="brand-mark">⏰</div>
          <h1>Hết giờ chat miễn phí</h1>
          <p className="join-copy">
            Bạn đã dùng hết 10 phút chat miễn phí. Tính năng nâng cấp trả phí (10k/1h, 50k/48h) sẽ sớm ra mắt.
          </p>
          <button type="button" onClick={logout}>Đăng xuất</button>
        </div>
      </div>
    );
  }

  const username = user.displayName;

  return (
    <div className="chat-layout">
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="brand"><span className="brand-icon">✦</span><span>connect<span className="brand-dot">.</span></span></div>
          <button className="icon-button" aria-label="Đăng xuất" onClick={logout}>⎋</button>
        </div>
        <div className="room-card">
          <span className="room-avatar">#</span>
          <div><strong>Phòng chung</strong><small>Cuộc trò chuyện mở</small></div>
          <span className="live-dot" />
        </div>
        {!timeInfo.unlimited && timeInfo.remainingSeconds != null && (
          <div className="room-card" style={{ marginTop: 8 }}>
            <span className="room-avatar">⏱</span>
            <div><strong>{formatCountdown(timeInfo.remainingSeconds)}</strong><small>Thời gian miễn phí còn lại</small></div>
          </div>
        )}
        <div className="people-heading"><span>Thành viên</span><b>{onlineUsers.length}</b></div>
        <ul className="people-list">
          {onlineUsers.map((u, i) => (
            <li key={`${u}-${i}`}><Avatar name={u} size={34} /><span>{u}{u === username && <small>Bạn</small>}</span><i /></li>
          ))}
        </ul>
        <div className="sidebar-footer">
          <Avatar name={username} size={38} />
          <div><strong>{username}</strong><small>Đang hoạt động</small></div>
        </div>
      </aside>
      <main className="chat-main">
        <header className="chat-header">
          <div>
            <div className="header-kicker"><span className="live-dot" /> LIVE ROOM</div>
            <h2>Phòng chung</h2>
            <p>{onlineUsers.length} người đang kết nối</p>
          </div>
          <div className="header-actions">
            <button className="header-button" aria-label="Tìm kiếm">⌕</button>
            <button className="header-button" aria-label="Thông tin">ⓘ</button>
          </div>
        </header>
        <div className="messages">
          {messages.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">✦</div>
              <h3>Bắt đầu cuộc trò chuyện</h3>
              <p>Hãy gửi lời chào đầu tiên đến mọi người trong phòng.</p>
            </div>
          )}
          {messages.map((m) =>
            m.system ? (
              <div key={m.id} className="message system">{m.text}</div>
            ) : (
              <div key={m.id} className={`message-row ${m.username === username ? "own" : ""}`}>
                {m.username !== username && <Avatar name={m.username} size={34} />}
                <div className="bubble">
                  {m.username !== username && <span className="message-author">{m.username}</span>}
                  {m.imageUrl && <img src={m.imageUrl} alt="Hình ảnh gửi trong chat" className="message-image" />}
                  {m.text && <span className="message-text">{m.text}</span>}
                  <span className="message-time">{formatTime(m.time)}</span>
                </div>
              </div>
            )
          )}
          <div ref={endRef} />
        </div>
        <div className="typing-indicator">
          {typingUser && typingUser !== username && (
            <span className="typing-pill"><span className="typing-dots"><i /><i /><i /></span>{typingUser} đang nhập</span>
          )}
          {uploading && <span className="typing-pill">Đang gửi ảnh...</span>}
        </div>
        <form className="composer" onSubmit={send}>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: "none" }} />
          <button type="button" className="attach-button" aria-label="Đính kèm" onClick={openFilePicker} disabled={uploading}>＋</button>
          <input aria-label="Tin nhắn" placeholder="Viết tin nhắn..." value={input} onChange={(e) => type(e.target.value)} />
          <button className="send-button" type="submit" disabled={!input.trim()} aria-label="Gửi tin nhắn">↑</button>
        </form>
      </main>
    </div>
  );
}