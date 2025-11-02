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
const CLOUDINARY_ROOT_FOLDER = 'file_copilot_app_files'; // Thư mục gốc cố định

// ☁️ Cấu hình Cloudinary
cloudinary.config({
  cloud_name: 'de8lh9qxq',
  api_key: '592925679739182',
  api_secret: 'KWxr5Ik7N4GbNnJ-iuFdUIZPaQU'
});

// ---------------------------------------------------
// CHỨC NĂNG BASE64 PUBLIC ID (Đảm bảo an toàn ký tự)
// ---------------------------------------------------
function encodeBase64Url(text) {
    // Mã hóa tên file không extension
    return Buffer.from(text, 'utf8').toString('base64url');
}

function decodeBase64Url(encodedText) {
    // Giải mã Base64url
    return Buffer.from(encodedText, 'base64url').toString('utf8');
}
// ---------------------------------------------------

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
  const originalFileName = req.file.originalname;
  const baseName = path.parse(originalFileName).name;
  
  // TẠO PUBLIC ID BẰNG BASE64
  const base64PublicId = encodeBase64Url(baseName); 

  try {
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { 
          folder: cloudinaryFolder,
          resource_type: 'raw', 
          public_id: base64PublicId, // PUBLIC ID ĐƯỢC MÃ HÓA
          filename: originalFileName
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
    });

    log(username, 'tải lên', originalFileName, folder);
    res.status(200).json({ url: result.secure_url });
  } catch (err) {
    console.error('Lỗi Cloudinary (Upload):', err);
    res.status(500).send('Lỗi khi tải lên Cloudinary');
  }
});

// --- ENDPOINT QUẢN LÝ FILE ---

// 📁 Duyệt thư mục
app.get('/browse', async (req, res) => {
  const folder = req.query.folder || '';
  const fullFolder = folder ? path.normalize(folder) : '';
  const cloudinaryPath = fullFolder ? path.join(CLOUDINARY_ROOT_FOLDER, fullFolder) : CLOUDINARY_ROOT_FOLDER; 

  try {
    // Duyệt file
    const searchResult = await cloudinary.search
      .expression(`folder=${cloudinaryPath}`) 
      .max_results(500)
      .execute();

    const files = searchResult.resources
      .filter(r => r.resource_type === 'raw')
      // Hiển thị tên file gốc (filename)
      .map(r => r.filename || decodeBase64Url(path.basename(r.public_id)) + path.extname(r.filename)); 

    // Duyệt folder
    const folderResult = await cloudinary.api.sub_folders(cloudinaryPath);
    const folders = folderResult.folders.map(f => f.name);

    res.json({ files, folders });

  } catch (error) {
    console.error('Lỗi Cloudinary (Browse):', error);
    if (error.http_code === 404) {
        return res.json({ files: [], folders: [] });
    }
    res.status(500).send('Lỗi khi tải nội dung: ' + error.message);
  }
});

// 📥 Tải file về (SỬA LỖI 500 BASE64)
app.get('/download/:fileName', async (req, res) => {
    // SỬ DỤNG decodeURIComponent để xử lý an toàn
    const decodedFileNameParam = decodeURIComponent(req.params.fileName); 
    const folder = req.query.folder || '';
    
    // Tách Public ID (Tên file không extension)
    const base64PublicId = decodedFileNameParam.substring(0, decodedFileNameParam.lastIndexOf('.'));
    const fileExtension = decodedFileNameParam.substring(decodedFileNameParam.lastIndexOf('.') + 1); 
    
    // Xây dựng Public ID chuẩn
    const publicId = [CLOUDINARY_ROOT_FOLDER, folder, base64PublicId].filter(Boolean).join('/'); 
    
    try {
        const resource = await cloudinary.api.resource(publicId, {
            resource_type: 'raw', 
            format: fileExtension, 
        });

        if (resource && resource.secure_url) {
            res.redirect(resource.secure_url); 
        } else {
            res.status(404).send('Không tìm thấy file trên Cloudinary');
        }
    } catch (error) {
        console.error('LỖI SERVER KHÔNG THỂ XỬ LÝ DOWNLOAD (500):', error);
        if (error.http_code === 404) {
             return res.status(404).send('File không tồn tại');
        }
        // Trả về 500 khi có lỗi trong quá trình xử lý Base64/API
        res.status(500).send('Lỗi máy chủ khi tải file: ' + error.message); 
    }
});

// 📂 Tạo thư mục mới
app.post('/create-folder', (req, res) => {
  const { folder, name, username } = req.body;
  const newFolderRelativePath = path.join(folder || '', name);
  const cloudinaryPath = path.join(CLOUDINARY_ROOT_FOLDER, newFolderRelativePath);

  try {
    cloudinary.api.create_folder(cloudinaryPath);
    log(username || 'unknown', 'tạo thư mục', '', newFolderRelativePath); 
    res.sendStatus(200);
  } catch (error) {
    if (error.http_code === 400 && error.message.includes('already exists')) {
        res.status(400).send('Thư mục đã tồn tại');
    } else {
        console.error('Lỗi Cloudinary (Create Folder):', error);
        res.status(500).send('Lỗi máy chủ khi tạo thư mục');
    }
  }
});

// 📝 Ghi đè nội dung file (Chỉ dùng cho TXT)
app.post('/save', async (req, res) => {
  const { fileName, content, folder, username } = req.body; // fileName là tên gốc
  const baseName = path.parse(fileName).name;
  const base64PublicId = encodeBase64Url(baseName);
  const publicId = [CLOUDINARY_ROOT_FOLDER, folder, base64PublicId].filter(Boolean).join('/');

  try {
    // Xóa file cũ
    await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
    
    // Upload nội dung mới
    await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { 
          folder: path.join(CLOUDINARY_ROOT_FOLDER, folder || ''),
          resource_type: 'raw',
          public_id: base64PublicId,
          filename: fileName // Tên hiển thị
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      streamifier.createReadStream(Buffer.from(content, 'utf8')).pipe(uploadStream);
    });

    log(username || 'unknown', 'chỉnh sửa', fileName, folder || '');
    res.sendStatus(200);

  } catch (error) {
    console.error('Lỗi Cloudinary (Save):', error);
    res.status(500).send('Lưu file thất bại: ' + error.message);
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
        const folder = path.dirname(fullPath).replace(`${CLOUDINARY_ROOT_FOLDER}/`, ''); 
        return { file: r.filename, folder: folder === '.' ? '' : folder };
      });

    res.json(results);
  } catch (error) {
    console.error('Lỗi Cloudinary (Search):', error);
    res.status(500).send('Lỗi khi tìm kiếm');
  }
});

// ✏️ Đổi tên file (Rename)
app.patch('/rename', async (req, res) => {
  const { folder, oldName, newName, username } = req.body; // oldName, newName là tên gốc
  
  // Lấy tên base đã mã hóa
  const oldBase64Name = encodeBase64Url(path.parse(oldName).name);
  const newBase64Name = encodeBase64Url(path.parse(newName).name);

  const oldPublicId = [CLOUDINARY_ROOT_FOLDER, folder, oldBase64Name].filter(Boolean).join('/');
  const newPublicId = [CLOUDINARY_ROOT_FOLDER, folder, newBase64Name].filter(Boolean).join('/');
  
  try {
    await cloudinary.uploader.rename(oldPublicId, newPublicId, {
      resource_type: 'raw',
      overwrite: true 
    });
    
    log(username || 'unknown', 'đổi tên file', `${oldName} thành ${newName}`, folder || '');
    res.sendStatus(200);

  } catch (error) {
    console.error('Lỗi Cloudinary (Rename):', error);
    res.status(500).send('Đổi tên thất bại');
  }
});

// 🗑️ Xóa file
app.post('/delete', async (req, res) => {
  const { folder, fileName, username } = req.body; // fileName là tên gốc
  const base64PublicId = encodeBase64Url(path.parse(fileName).name);
  const publicId = [CLOUDINARY_ROOT_FOLDER, folder, base64PublicId].filter(Boolean).join('/');

  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
    log(username || 'unknown', 'xóa file', fileName, folder || '');
    res.sendStatus(200);

  } catch (error) {
    console.error('Lỗi Cloudinary (Delete):', error);
    res.status(500).send('Xóa file thất bại');
  }
});

// 🗑️ Xóa thư mục
app.post('/delete-folder', async (req, res) => {
    const { folder, folderName, username } = req.body;
    const fullPath = [CLOUDINARY_ROOT_FOLDER, folder, folderName].filter(Boolean).join('/');
    
    try {
        await cloudinary.api.delete_folder(fullPath);
        log(username || 'unknown', 'xóa thư mục', '', fullPath);
        res.sendStatus(200);
    } catch (error) {
        console.error('Lỗi Cloudinary (Delete Folder):', error);
        res.status(500).send('Xóa thư mục thất bại: ' + error.message);
    }
});


// --- ENDPOINT LOG VÀ USER ---

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

// 🗑️ Xóa log 
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
