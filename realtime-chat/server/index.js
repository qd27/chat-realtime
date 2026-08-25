import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import mongoose from "mongoose";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = "token";
const isProd = process.env.NODE_ENV === "production";
const FREE_LIMIT_SECONDS = 10 * 60; // 10 phút miễn phí

function parseCookieHeader(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  });
  return out;
}

if (!JWT_SECRET) {
  console.error("❌ Thiếu biến môi trường JWT_SECRET");
}

// Danh sách domain frontend được phép kết nối
const ALLOWED_ORIGINS = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(",")
  : ["http://localhost:5173"];
console.log("👉 ALLOWED_ORIGINS đang dùng:", ALLOWED_ORIGINS);

const cookieOptions = {
  httpOnly: true,
  secure: isProd, // bắt buộc true khi chạy https (Railway)
  sameSite: isProd ? "none" : "lax", // "none" để cookie hoạt động xuyên domain Vercel <-> Railway
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 ngày
  path: "/",
};

// ---------- MongoDB ----------
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  displayName: { type: String, required: true },
  totalSecondsUsed: { type: Number, default: 0 },
  paidUntil: { type: Date, default: null }, // để trống, dùng cho tính năng trả phí sau này
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);

const messageSchema = new mongoose.Schema({
  username: { type: String, required: true },
  text: { type: String },
  imageUrl: { type: String },
  time: { type: Date, default: Date.now },
});

const Message = mongoose.model("Message", messageSchema);

const MAX_MESSAGES = 200;

async function trimOldMessages() {
  try {
    const count = await Message.countDocuments();
    if (count > MAX_MESSAGES) {
      const excess = count - MAX_MESSAGES;
      const oldMessages = await Message.find().sort({ time: 1 }).limit(excess).select("_id");
      const ids = oldMessages.map((m) => m._id);
      await Message.deleteMany({ _id: { $in: ids } });
      console.log(`🧹 Đã dọn ${ids.length} tin nhắn cũ (vượt giới hạn ${MAX_MESSAGES})`);
    }
  } catch (err) {
    console.error("Lỗi khi dọn tin nhắn cũ:", err);
  }
}

// ---------- Helper auth ----------
function isPaid(user) {
  return !!(user.paidUntil && new Date(user.paidUntil) > new Date());
}

function signToken(user) {
  return jwt.sign({ uid: user._id.toString() }, JWT_SECRET, { expiresIn: "30d" });
}

function toSafeUser(user) {
  return {
    id: user._id,
    email: user.email,
    displayName: user.displayName,
    remainingSeconds: isPaid(user) ? null : Math.max(0, FREE_LIMIT_SECONDS - user.totalSecondsUsed),
    unlimited: isPaid(user),
  };
}

function authMiddleware(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Chưa đăng nhập" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.uid;
    next();
  } catch {
    return res.status(401).json({ error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn" });
  }
}

// ---------- Cloudinary ----------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: "realtime-chat" }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

// ---------- Express ----------
const app = express();
app.set("trust proxy", 1); // Railway chạy sau proxy, cần cái này để cookie secure hoạt động đúng
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/", (req, res) => res.send("Realtime chat server is running."));
app.get("/health", (req, res) => res.json({ ok: true }));

// ---------- Auth routes ----------
app.post("/api/register", async (req, res) => {
  try {
    const { email, password, displayName } = req.body || {};
    if (!email || !password || !displayName) {
      return res.status(400).json({ error: "Thiếu email, mật khẩu hoặc tên hiển thị" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Mật khẩu cần ít nhất 6 ký tự" });
    }
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ error: "Email này đã được đăng ký" });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      email: email.toLowerCase().trim(),
      passwordHash,
      displayName: displayName.trim(),
    });
    const token = signToken(user);
    res.cookie(COOKIE_NAME, token, cookieOptions);
    res.json({ user: toSafeUser(user) });
  } catch (err) {
    console.error("Lỗi đăng ký:", err);
    res.status(500).json({ error: "Đăng ký thất bại, vui lòng thử lại" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Thiếu email hoặc mật khẩu" });
    }
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(401).json({ error: "Email hoặc mật khẩu không đúng" });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Email hoặc mật khẩu không đúng" });
    const token = signToken(user);
    res.cookie(COOKIE_NAME, token, cookieOptions);
    res.json({ user: toSafeUser(user) });
  } catch (err) {
    console.error("Lỗi đăng nhập:", err);
    res.status(500).json({ error: "Đăng nhập thất bại, vui lòng thử lại" });
  }
});

app.post("/api/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: 0 });
  res.json({ ok: true });
});

app.get("/api/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ error: "Không tìm thấy user" });
    res.json({ user: toSafeUser(user) });
  } catch (err) {
    console.error("Lỗi /api/me:", err);
    res.status(500).json({ error: "Có lỗi xảy ra" });
  }
});

app.post("/api/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Không có file ảnh nào được gửi." });
    const result = await uploadToCloudinary(req.file.buffer);
    res.json({ url: result.secure_url });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Upload ảnh thất bại." });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST"], credentials: true },
});

// ---------- Socket.IO auth middleware ----------
io.use(async (socket, next) => {
  try {
    const rawCookie = socket.request.headers.cookie;
    if (!rawCookie) return next(new Error("unauthorized"));
    const parsed = parseCookieHeader(rawCookie);
    const token = parsed[COOKIE_NAME];
    if (!token) return next(new Error("unauthorized"));
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.uid);
    if (!user) return next(new Error("unauthorized"));
    socket.user = user;
    next();
  } catch (err) {
    next(new Error("unauthorized"));
  }
});

const onlineUsers = new Map(); // socket.id -> displayName

io.on("connection", (socket) => {
  const user = socket.user;
  const displayName = user.displayName;
  console.log(`[connect] ${socket.id} (${user.email})`);

  const paid = isPaid(user);
  let remaining = paid ? null : Math.max(0, FREE_LIMIT_SECONDS - user.totalSecondsUsed);
  let secondsSinceFlush = 0;
  let tickInterval = null;

  if (!paid && remaining <= 0) {
    socket.emit("time-info", { remainingSeconds: 0, unlimited: false });
    socket.emit("limit-reached");
    socket.disconnect(true);
    return;
  }

  onlineUsers.set(socket.id, displayName);
  io.emit("online-users", Array.from(onlineUsers.values()));
  socket.broadcast.emit("system-message", `${displayName} đã tham gia phòng chat`);

  Message.find()
    .sort({ time: -1 })
    .limit(50)
    .lean()
    .then((history) => socket.emit("chat-history", history.reverse()))
    .catch((err) => console.error("Lỗi khi lấy lịch sử tin nhắn:", err));

  socket.emit("time-info", { remainingSeconds: remaining, unlimited: paid });

  if (!paid) {
    tickInterval = setInterval(async () => {
      remaining -= 1;
      secondsSinceFlush += 1;
      socket.emit("time-info", { remainingSeconds: remaining, unlimited: false });

      if (secondsSinceFlush >= 10) {
        const toFlush = secondsSinceFlush;
        secondsSinceFlush = 0;
        try {
          await User.updateOne({ _id: user._id }, { $inc: { totalSecondsUsed: toFlush } });
        } catch (err) {
          console.error("Lỗi cập nhật totalSecondsUsed:", err);
        }
      }

      if (remaining <= 0) {
        socket.emit("limit-reached");
        socket.disconnect(true);
      }
    }, 1000);
  }

  socket.on("chat-message", async (payload) => {
    const message = {
      username: displayName, // luôn lấy từ user đã xác thực, không tin dữ liệu client gửi lên
      text: payload?.text || "",
      imageUrl: payload?.imageUrl || null,
      time: new Date(),
    };
    io.emit("chat-message", { ...message, id: `${socket.id}-${Date.now()}` });
    try {
      await Message.create(message);
      trimOldMessages();
    } catch (err) {
      console.error("Lỗi khi lưu tin nhắn:", err);
    }
  });

  socket.on("typing", () => socket.broadcast.emit("typing", displayName));
  socket.on("stop-typing", () => socket.broadcast.emit("stop-typing"));

  socket.on("disconnect", async () => {
    if (tickInterval) clearInterval(tickInterval);
    if (!paid && secondsSinceFlush > 0) {
      try {
        await User.updateOne({ _id: user._id }, { $inc: { totalSecondsUsed: secondsSinceFlush } });
      } catch (err) {
        console.error("Lỗi cập nhật totalSecondsUsed lúc disconnect:", err);
      }
    }
    onlineUsers.delete(socket.id);
    io.emit("online-users", Array.from(onlineUsers.values()));
    socket.broadcast.emit("system-message", `${displayName} đã rời phòng chat`);
    console.log(`[disconnect] ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});