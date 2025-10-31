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
const CLOUDINARY_ROOT_FOLDER = 'file_copilot_app_files'; // Đặt tên thư mục gốc cố định trên Cloudinary

// ☁️ Cấu hình Cloudinary (Dùng cấu hình bạn đã cung cấp)
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

// 📤 Cấu hình Multer: Upload file lên Cloudinary
const upload = multer();

app.post('/upload', upload.single('file'), async (req, res) => {
  const folder = req.body.folder || '';
  const username = req.body.username || 'unknown';
  const cloudinaryFolder = path.join(CLOUDINARY_ROOT_FOLDER, folder);

  try {
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { 
          folder: cloudinaryFolder,
          resource_type: 'raw', // Lưu dưới dạng file thô
          public_id: path.parse(req.file.originalname).name, // Dùng tên file làm public_id
          filename: req.file.originalname
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
    });

    log(username, 'tải lên', req.file.originalname, folder);
    res.status(200).json({ url: result.secure_url });
  } catch (err) {
    console.error('Lỗi Cloudinary:', err);
    res.status(500).send('Lỗi khi tải lên Cloudinary');
  }
});

// --- ENDPOINT QUẢN LÝ FILE (ĐÃ BỔ SUNG) ---

// 📁 Duyệt thư mục
app.get('/browse', async (req, res) => {
  const folder = req.query.folder || '';
  const cloudinaryPath = folder ? path.join(CLOUDINARY_ROOT_FOLDER, folder) : CLOUDINARY_ROOT_FOLDER; 

  try {
    // Duyệt file
    const searchResult = await cloudinary.search
      .expression(`folder=${cloudinaryPath}`) 
      .max_results(500)
      .execute();

    const files = searchResult.resources
      .filter(r => r.resource_type === 'raw')
      .map(r => r.filename || r.public_id.split('/').pop()); 

    // Duyệt folder
    const folderResult = await cloudinary.api.sub_folders(cloudinaryPath);
    const folders = folderResult.folders.map(f => f.name);

    res.json({ files, folders });

  } catch (error) {
    console.error('Lỗi Cloudinary khi duyệt:', error);
    if (error.http_code === 404) {
        return res.json({ files: [], folders: [] }); // Trả về rỗng nếu folder chưa tồn tại
    }
    res.status(500).send('Lỗi khi tải nội dung: ' + error.message);
  }
});

// 📂 Tạo thư mục mới
app.post('/create-folder', async (req, res) => {
  const { folder, name, username } = req.body;
  const newFolderRelativePath = path.join(folder || '', name);
  const cloudinaryPath = path.join(CLOUDINARY_ROOT_FOLDER, newFolderRelativePath);

  try {
    await cloudinary.api.create_folder(cloudinaryPath);
    log(username || 'unknown', 'tạo thư mục', '', newFolderRelativePath); 
    res.sendStatus(200);
  } catch (error) {
    if (error.http_code === 400 && error.message.includes('already exists')) {
        res.status(400).send('Thư mục đã tồn tại');
    } else {
        console.error('Lỗi Cloudinary khi tạo folder:', error);
        res.status(500).send('Lỗi máy chủ khi tạo thư mục');
    }
  }
});

// 📝 Ghi đè nội dung file (Chỉ dùng cho TXT)
app.post('/save', async (req, res) => {
  const { fileName, content, folder, username } = req.body;
  const publicId = path.join(CLOUDINARY_ROOT_FOLDER, folder || '', path.parse(fileName).name);

  try {
    // Xóa file cũ và upload nội dung mới
    await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
    
    await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { 
          folder: path.join(CLOUDINARY_ROOT_FOLDER, folder || ''),
          resource_type: 'raw',
          public_id: path.parse(fileName).name,
          filename: fileName // Đảm bảo tên file được giữ nguyên
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      // Upload từ buffer của nội dung text
      streamifier.createReadStream(Buffer.from(content, 'utf8')).pipe(uploadStream);
    });

    log(username || 'unknown', 'chỉnh sửa', fileName, folder || '');
    res.sendStatus(200);

  } catch (error) {
    console.error('Lỗi Cloudinary khi lưu file:', error);
    res.status(500).send('Lưu file thất bại: ' + error.message);
  }
});

// 📥 Tải file về (Dùng redirect đến URL bảo mật)
app.get('/download/:fileName', async (req, res) => {
    const { fileName } = req.params;
    const folder = req.query.folder || '';
    const fileExtension = path.extname(fileName).substring(1);
    const fileBaseName = path.parse(fileName).name;
    
    const publicId = path.join(CLOUDINARY_ROOT_FOLDER, folder || '', fileBaseName); 
    
    try {
        const resource = await cloudinary.api.resource(publicId, {
            resource_type: 'raw', 
            format: fileExtension,
        });

        if (resource && resource.secure_url) {
            // Chuyển hướng đến URL tải về của Cloudinary
            res.redirect(resource.secure_url);
        } else {
            res.status(404).send('Không tìm thấy file trên Cloudinary');
        }
    } catch (error) {
        console.error('Lỗi Cloudinary khi tải về:', error);
        res.status(500).send('Lỗi máy chủ khi tải file: ' + error.message);
    }
});

// 🔍 Tìm kiếm file
app.get('/search', async (req, res) => {
  const keyword = req.query.keyword?.toLowerCase() || '';

  try {
    const searchResult = await cloudinary.search
      .expression(`folder=${CLOUDINARY_ROOT_FOLDER}/* AND filename=*${keyword}*`)
      .max_results(500)
      .execute();

    const results = searchResult.resources
      .filter(r => r.resource_type === 'raw')
      .map(r => {
        const fullPath = r.public_id;
        // Loại bỏ CLOUDINARY_ROOT_FOLDER/ và tên file
        const folder = path.dirname(fullPath).replace(`${CLOUDINARY_ROOT_FOLDER}/`, ''); 
        return { file: r.filename, folder: folder === '.' ? '' : folder };
      });

    res.json(results);
  } catch (error) {
    console.error('Lỗi Cloudinary khi tìm kiếm:', error);
    res.status(500).send('Lỗi khi tìm kiếm');
  }
});

// ✏️ Đổi tên file (Rename)
app.patch('/rename', async (req, res) => {
  const { folder, oldName, newName, username } = req.body;
  const oldPublicId = path.join(CLOUDINARY_ROOT_FOLDER, folder || '', path.parse(oldName).name);
  const newPublicId = path.join(CLOUDINARY_ROOT_FOLDER, folder || '', path.parse(newName).name);
  
  try {
    // Đổi tên public_id trên Cloudinary
    await cloudinary.uploader.rename(oldPublicId, newPublicId, {
      resource_type: 'raw',
      overwrite: true // Cho phép ghi đè nếu tên mới đã tồn tại
    });
    
    log(username || 'unknown', 'đổi tên file', `${oldName} thành ${newName}`, folder || '');
    res.sendStatus(200);

  } catch (error) {
    console.error('Lỗi Cloudinary khi đổi tên:', error);
    res.status(500).send('Đổi tên thất bại');
  }
});

// 🗑️ Xóa file
app.post('/delete', async (req, res) => {
  const { folder, fileName, username } = req.body;
  const publicId = path.join(CLOUDINARY_ROOT_FOLDER, folder || '', path.parse(fileName).name);

  try {
    // Xóa resource trên Cloudinary
    await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
    log(username || 'unknown', 'xóa file', fileName, folder || '');
    res.sendStatus(200);

  } catch (error) {
    console.error('Lỗi Cloudinary khi xóa:', error);
    res.status(500).send('Xóa file thất bại');
  }
});

// --- ENDPOINT LOG VÀ USER (Giữ nguyên logic của bạn) ---

// 📜 Xem nhật ký hoạt động
app.get('/log', (req, res) => {
  const logs = fs.existsSync(LOGS_FILE) ? JSON.parse(fs.readFileSync(LOGS_FILE)) : [];
  res.json(logs.reverse());
});

// 📋 Ghi log từ client
app.post('/log', (req, res) => {
  const { username, action, file, folder } = req.body;
  log(username, action, file, folder);
  res.sendStatus(200);
});

// 🗑️ Xóa log (Dùng DELETE /log để đồng bộ với Flutter)
app.delete('/log', (req, res) => {
  const { timestamps } = req.body;
  if (!timestamps || timestamps.length === 0) return res.status(400).send('Cần timestamps để xóa');
  
  let logs = fs.existsSync(LOGS_FILE) ? JSON.parse(fs.readFileSync(LOGS_FILE)) : [];
  logs = logs.filter(l => !timestamps.includes(l.timestamp));
  fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2));
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
