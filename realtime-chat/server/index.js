import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const PORT = process.env.PORT || 4000;

// Danh sách domain frontend được phép kết nối (thêm domain Vercel của bạn vào đây)
const ALLOWED_ORIGINS = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(",")
  : ["http://localhost:5173"];

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.get("/", (req, res) => res.send("Realtime chat server is running."));
app.get("/health", (req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
  },
});

// Lưu tạm danh sách user online (chỉ trong bộ nhớ, mất khi restart server)
const onlineUsers = new Map(); // socket.id -> username

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on("join", (username) => {
    onlineUsers.set(socket.id, username || "Ẩn danh");
    io.emit("online-users", Array.from(onlineUsers.values()));
    socket.broadcast.emit("system-message", `${onlineUsers.get(socket.id)} đã tham gia phòng chat`);
  });

  socket.on("chat-message", (payload) => {
    // payload: { text, username }
    const message = {
      id: `${socket.id}-${Date.now()}`,
      text: payload.text,
      username: payload.username || onlineUsers.get(socket.id) || "Ẩn danh",
      time: new Date().toISOString(),
    };
    io.emit("chat-message", message);
  });

  socket.on("typing", (username) => {
    socket.broadcast.emit("typing", username);
  });

  socket.on("stop-typing", () => {
    socket.broadcast.emit("stop-typing");
  });

  socket.on("disconnect", () => {
    const username = onlineUsers.get(socket.id);
    onlineUsers.delete(socket.id);
    io.emit("online-users", Array.from(onlineUsers.values()));
    if (username) {
      socket.broadcast.emit("system-message", `${username} đã rời phòng chat`);
    }
    console.log(`[disconnect] ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
