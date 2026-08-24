import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import mongoose from "mongoose";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";

const PORT = process.env.PORT || 4000;

// Danh sách domain frontend được phép kết nối
const ALLOWED_ORIGINS = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(",")
  : ["http://localhost:5173"];
console.log("👉 ALLOWED_ORIGINS đang dùng:", ALLOWED_ORIGINS);

// ---------- MongoDB ----------
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

const messageSchema = new mongoose.Schema({
  username: { type: String, required: true },
  text: { type: String },
  imageUrl: { type: String },
  time: { type: Date, default: Date.now },
});

const Message = mongoose.model("Message", messageSchema);

// ---------- Cloudinary ----------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "realtime-chat" },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

// ---------- Express ----------
const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

app.get("/", (req, res) => res.send("Realtime chat server is running."));
app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/api/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Không có file ảnh nào được gửi." });
    }
    const result = await uploadToCloudinary(req.file.buffer);
    res.json({ url: result.secure_url });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Upload ảnh thất bại." });
  }
});

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

  socket.on("join", async (username) => {
    onlineUsers.set(socket.id, username || "Ẩn danh");
    io.emit("online-users", Array.from(onlineUsers.values()));
    socket.broadcast.emit(
      "system-message",
      `${onlineUsers.get(socket.id)} đã tham gia phòng chat`
    );

    // Gửi lịch sử 50 tin gần nhất chỉ cho người vừa join
    try {
      const history = await Message.find()
        .sort({ time: -1 })
        .limit(50)
        .lean();
      socket.emit("chat-history", history.reverse());
    } catch (err) {
      console.error("Lỗi khi lấy lịch sử tin nhắn:", err);
    }
  });

  socket.on("chat-message", async (payload) => {
    // payload: { text, username, imageUrl }
    const username = payload.username || onlineUsers.get(socket.id) || "Ẩn danh";

    const message = {
      username,
      text: payload.text || "",
      imageUrl: payload.imageUrl || null,
      time: new Date(),
    };

    io.emit("chat-message", { ...message, id: `${socket.id}-${Date.now()}` });

    try {
      await Message.create(message);
    } catch (err) {
      console.error("Lỗi khi lưu tin nhắn:", err);
    }
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