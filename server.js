const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const USERS_FILE = path.join(__dirname, 'users.json');
const LOGS_FILE = path.join(__dirname, 'logs.json');

// ☁️ Cấu hình Cloudinary
cloudinary.config({
  cloud_name: 'de8lh9qxq',
  api_key: '592925679739182',
  api_secret: 'KWxr5Ik7N4GbNnJ-iuFdUIZPaQU'
});

// 📋 Ghi log hoạt động
function log(username, action, file, folder) {
  const logs = fs.existsSync(LOGS_FILE) ? JSON.parse(fs.readFileSync(LOGS_FILE)) : [];
  logs.push({
    timestamp: new Date().toISOString(),
    username,
    action,
    file,
    folder
  });
  fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2));
}

// 📤 Upload file lên Cloudinary
const upload = multer();

app.post('/upload', upload.single('file'), async (req, res) => {
  const folder = req.body.folder || '';
  const username = req.body.username || 'unknown';

  try {
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
    });

    log(username, 'tải lên', result.original_filename, folder);
    res.status(200).json({ url: result.secure_url });
  } catch (err) {
    console.error('Lỗi Cloudinary:', err);
    res.status(500).send('Lỗi khi tải lên Cloudinary');
  }
});

// 📜 Xem nhật ký hoạt động
app.get('/log', (req, res) => {
  const logs = fs.existsSync(LOGS_FILE) ? JSON.parse(fs.readFileSync(LOGS_FILE)) : [];
  res.json(logs.reverse());
});

// 🗑️ Xóa log (1 hoặc nhiều)
app.post('/log/delete', (req, res) => {
  const { logs: toDelete } = req.body;
  if (!Array.isArray(toDelete)) return res.status(400).send('Dữ liệu không hợp lệ');

  let logs = fs.existsSync(LOGS_FILE) ? JSON.parse(fs.readFileSync(LOGS_FILE)) : [];
  logs = logs.filter(log => !toDelete.some(del =>
    del.timestamp === log.timestamp &&
    del.username === log.username &&
    del.action === log.action &&
    del.file === log.file &&
    del.folder === log.folder
  ));
  fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2));
  res.sendStatus(200);
});

// 🧹 Xóa toàn bộ log
app.post('/log/clear', (req, res) => {
  fs.writeFileSync(LOGS_FILE, JSON.stringify([], null, 2));
  res.sendStatus(200);
});

// 👤 Quản lý người dùng
app.get('/users', (req, res) => {
  const users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE)) : [];
  res.json(users);
});

app.post('/users', (req, res) => {
  const { username, password, role } = req.body;
  const users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE)) : [];
  if (users.find(u => u.username === username)) {
    return res.status(400).send('Tên đăng nhập đã tồn tại');
  }
  users.push({ username, password, role });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  res.sendStatus(200);
});

app.patch('/users/:username', (req, res) => {
  const username = req.params.username;
  const { password, role } = req.body;
  const users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE)) : [];
  const index = users.findIndex(u => u.username === username);
  if (index === -1) return res.status(404).send('Không tìm thấy người dùng');
  users[index].password = password;
  users[index].role = role;
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  res.sendStatus(200);
});

app.delete('/users/:username', (req, res) => {
  const username = req.params.username;
  let users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE)) : [];
  users = users.filter(u => u.username !== username);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  res.sendStatus(200);
});

// ✅ Khởi động server
app.listen(PORT, () => {
  console.log(`✅ Server đang chạy tại http://localhost:${PORT}`);
});
