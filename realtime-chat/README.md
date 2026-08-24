# Realtime Chat (React + Socket.IO)

Cấu trúc:
```
realtime-chat/
  server/   → Node.js + Express + Socket.IO (deploy lên Railway/Render, KHÔNG deploy lên Vercel)
  client/   → React + Vite (deploy lên Vercel)
```

Lý do tách 2 phần: Vercel chạy serverless, không giữ được kết nối WebSocket
sống lâu dài. Socket.IO cần một server chạy liên tục nên phải host ở nơi
khác (Railway, Render, Fly.io...).

## 1. Chạy thử ở local

**Backend:**
```bash
cd server
npm install
cp .env.example .env
npm run dev
# server chạy ở http://localhost:4000
```

**Frontend:**
```bash
cd client
npm install
cp .env.example .env
npm run dev
# mở http://localhost:5173
```

Mở 2 tab trình duyệt để test chat realtime giữa 2 "user".

## 2. Deploy backend lên Railway (hoặc Render)

**Railway:**
1. Tạo project mới → "Deploy from GitHub repo" → chọn repo, thư mục gốc là `server/`
   (hoặc dùng Railway CLI: `railway init` trong thư mục `server/`)
2. Railway tự nhận diện Node.js, chạy `npm install` rồi `npm start`
3. Vào tab **Variables**, thêm biến:
   - `CLIENT_URL` = `https://ten-app-cua-ban.vercel.app` (điền sau khi deploy frontend ở bước 3)
4. Railway cấp cho bạn 1 domain dạng `https://xxx.up.railway.app` — đây chính là `SERVER_URL`

**Render (thay thế):**
1. New → Web Service → connect repo, Root Directory = `server`
2. Build Command: `npm install`, Start Command: `npm start`
3. Thêm biến môi trường `CLIENT_URL` tương tự như trên

## 3. Deploy frontend lên Vercel

1. Import project trên Vercel, chọn Root Directory = `client`
2. Framework Preset: Vite (Vercel tự nhận diện)
3. Vào Settings → Environment Variables, thêm:
   - `VITE_SERVER_URL` = `https://xxx.up.railway.app` (domain backend ở bước 2, dùng `https://`, Socket.IO tự nâng cấp lên `wss://`)
4. Deploy

## 4. Nối lại 2 domain

Sau khi có domain Vercel thật (vd `https://my-chat.vercel.app`), quay lại Railway/Render
cập nhật biến `CLIENT_URL` thành domain đó, rồi redeploy backend để CORS
cho phép đúng domain frontend kết nối tới.

## Ghi chú

- Danh sách tin nhắn và user online hiện lưu trong bộ nhớ server (mất khi
  server restart). Muốn lưu lâu dài, bạn có thể thêm một database (MongoDB,
  Postgres...) ở phần `server/index.js`.
- Có thể thêm nhiều "phòng" (room) bằng cách dùng `socket.join(roomName)` của Socket.IO.
