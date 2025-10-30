const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const USERS_FILE = path.join(__dirname, 'users.json');
const LOGS_FILE = path.join(__dirname, 'logs.json');
const FILES_DIR = path.join(__dirname, 'files');

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

// 📤 Cấu hình Multer để lưu file
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = req.body.folder || '';
    const uploadPath = path.join(FILES_DIR, folder);
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage });

// 📥 Tải lên file
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).send('Không nhận được file');
  const folder = req.body.folder || '';
  const username = req.body.username || 'unknown';
  log(username, 'tải lên', req.file.originalname, folder);
  res.status(200).send('Tải lên thành công');
});

// 📁 Duyệt thư mục
app.get('/browse', (req, res) => {
  const folder = req.query.folder || '';
  const basePath = path.join(FILES_DIR, folder);
  if (!fs.existsSync(basePath)) return res.status(404).send('Không tìm thấy thư mục');

  const items = fs.readdirSync(basePath);
  const folders = [];
  const files = [];

  items.forEach(item => {
    const itemPath = path.join(basePath, item);
    if (fs.statSync(itemPath).isDirectory()) {
      folders.push(item);
    } else {
      files.push(item);
    }
  });

  res.json({ folders, files });
});

// 📥 Tải file về
app.get('/download/:fileName', (req, res) => {
  const fileName = req.params.fileName;
  const folder = req.query.folder || '';
  const filePath = path.join(FILES_DIR, folder, fileName);
  if (!fs.existsSync(filePath)) return res.status(404).send('Không tìm thấy file');
  res.sendFile(filePath);
});

// 📝 Ghi đè nội dung file
app.post('/save', (req, res) => {
  const { fileName, content, folder, username } = req.body;
  const filePath = path.join(FILES_DIR, folder || '', fileName);
  fs.writeFileSync(filePath, content, 'utf8');
  log(username || 'unknown', 'chỉnh sửa', fileName, folder || '');
  res.sendStatus(200);
});

// 📂 Tạo thư mục mới
app.post('/create-folder', (req, res) => {
  const { folder, name } = req.body;
  const fullPath = path.join(FILES_DIR, folder, name);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    res.sendStatus(200);
  } else {
    res.status(400).send('Thư mục đã tồn tại');
  }
});

// 🔍 Tìm kiếm file
app.get('/search', (req, res) => {
  const keyword = req.query.keyword?.toLowerCase() || '';
  const results = [];

  function scanFolder(folderPath, relativePath = '') {
    const items = fs.readdirSync(folderPath);
    items.forEach(item => {
      const fullPath = path.join(folderPath, item);
      const relPath = path.join(relativePath, item);
      if (fs.statSync(fullPath).isDirectory()) {
        scanFolder(fullPath, relPath);
      } else if (item.toLowerCase().includes(keyword)) {
        results.push({ file: item, folder: relativePath });
      }
    });
  }

  scanFolder(FILES_DIR);
  res.json(results);
});

// ✏️ Đổi tên file
app.post('/rename', (req, res) => {
  const { folder, oldName, newName } = req.body;
  const oldPath = path.join(FILES_DIR, folder, oldName);
  const newPath = path.join(FILES_DIR, folder, newName);
  if (fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, newPath);
    log('admin', 'đổi tên', `${oldName} → ${newName}`, folder);
    res.sendStatus(200);
  } else {
    res.status(404).send('Không tìm thấy file');
  }
});

// 🗑️ Xóa file
app.post('/delete', (req, res) => {
  const { folder, fileName } = req.body;
  const filePath = path.join(FILES_DIR, folder, fileName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    log('admin', 'xóa', fileName, folder);
    res.sendStatus(200);
  } else {
    res.status(404).send('Không tìm thấy file');
  }
});

// 📋 Ghi log từ client
app.post('/log', (req, res) => {
  const { username, action, file, folder } = req.body;
  log(username, action, file, folder);
  res.sendStatus(200);
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
