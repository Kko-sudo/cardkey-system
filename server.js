const express = require('express');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const dbFile = path.join(__dirname, 'keys.json');
const adapter = new JSONFile(dbFile);
const db = new Low(adapter, { keys: [], users: [], programs: [] });

db.read().then(() => {
  if (!db.data.keys) {
    db.data.keys = [];
  }
  if (!db.data.users) {
    db.data.users = [];
    db.data.users.push({
      id: 1,
      username: 'xpb',
      password: 'xpb@04103013'
    });
  }
  if (!db.data.programs) {
    db.data.programs = [];
    db.data.programs.push({
      id: 1,
      name: '农行专用程序',
      path: '.data\\app_core.exe',
      created_at: new Date().toISOString()
    });
  }
  db.write();
}).catch(() => {
  db.data = { keys: [], users: [], programs: [] };
  db.data.users.push({
    id: 1,
    username: 'xpb',
    password: 'xpb@04103013'
  });
  db.data.programs.push({
    id: 1,
    name: '农行专用程序',
    path: '.data\\app_core.exe',
    created_at: new Date().toISOString()
  });
  db.write();
});

function generateKey(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let key = '';
  for (let i = 0; i < length; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

function authenticateUser(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权访问' });
  }
  
  const token = authHeader.substring(7);
  const user = db.data.users.find(u => u.id === parseInt(token));
  
  if (!user) {
    return res.status(401).json({ error: '无效的授权令牌' });
  }
  
  req.user = user;
  next();
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  
  const user = db.data.users.find(u => u.username === username && u.password === password);
  
  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  
  res.json({ 
    success: true, 
    message: '登录成功',
    token: user.id.toString(),
    user: {
      id: user.id,
      username: user.username
    }
  });
});

app.post('/api/generate-key', authenticateUser, (req, res) => {
  const { duration, count = 1 } = req.body;
  
  if (!duration || duration <= 0) {
    return res.status(400).json({ error: '无效的时长' });
  }

  const keys = [];
  const errors = [];
  const now = new Date();

  for (let i = 0; i < count; i++) {
    const keyCode = generateKey();
    const expiresAt = new Date(now.getTime() + duration * 24 * 60 * 60 * 1000);
    
    const existingKey = db.data.keys.find(k => k.key_code === keyCode);
    if (existingKey) {
      errors.push({ index: i, error: '卡密重复，请重试' });
      continue;
    }
    
    const newKey = {
      id: Date.now() + i,
      key_code: keyCode,
      duration: duration,
      status: 'unused',
      created_at: now.toISOString(),
      used_at: null,
      machine_id: null,
      expires_at: expiresAt.toISOString()
    };
    
    db.data.keys.push(newKey);
    keys.push(newKey);
  }
  
  db.write();
  res.json({ success: true, keys, errors });
});

app.post('/api/verify-key', (req, res) => {
  const { key_code, machine_id } = req.body;
  
  if (!key_code || !machine_id) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  const keyIndex = db.data.keys.findIndex(k => k.key_code === key_code);
  
  if (keyIndex === -1) {
    return res.json({ valid: false, message: '卡密不存在' });
  }
  
  const key = db.data.keys[keyIndex];
  const now = new Date();
  const expiresAt = new Date(key.expires_at);
  
  if (now > expiresAt) {
    return res.json({ valid: false, message: '卡密已过期' });
  }
  
  if (key.status === 'used') {
    if (key.machine_id === machine_id) {
      const remainingDays = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
      return res.json({ 
        valid: true, 
        message: '验证成功',
        remaining_days: remainingDays,
        expires_at: key.expires_at
      });
    } else {
      return res.json({ valid: false, message: '卡密已被其他设备使用' });
    }
  }
  
  key.status = 'used';
  key.used_at = now.toISOString();
  key.machine_id = machine_id;
  db.data.keys[keyIndex] = key;
  db.write();
  
  const remainingDays = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
  res.json({ 
    valid: true, 
    message: '验证成功',
    remaining_days: remainingDays,
    expires_at: expiresAt.toISOString()
  });
});

app.get('/api/keys', authenticateUser, (req, res) => {
  res.json(db.data.keys.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.delete('/api/keys/:id', authenticateUser, (req, res) => {
  const { id } = req.params;
  db.data.keys = db.data.keys.filter(k => k.id !== parseInt(id));
  db.write();
  res.json({ success: true, message: '删除成功' });
});

app.get('/api/programs', authenticateUser, (req, res) => {
  res.json(db.data.programs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.post('/api/programs', authenticateUser, (req, res) => {
  const { name, path } = req.body;
  
  if (!name || !path) {
    return res.status(400).json({ error: '程序名称和路径不能为空' });
  }
  
  const newProgram = {
    id: Date.now(),
    name: name,
    path: path,
    created_at: new Date().toISOString()
  };
  
  db.data.programs.push(newProgram);
  db.write();
  res.json({ success: true, program: newProgram });
});

app.put('/api/programs/:id', authenticateUser, (req, res) => {
  const { id } = req.params;
  const { name, path } = req.body;
  
  const programIndex = db.data.programs.findIndex(p => p.id === parseInt(id));
  
  if (programIndex === -1) {
    return res.status(404).json({ error: '程序不存在' });
  }
  
  if (name) {
    db.data.programs[programIndex].name = name;
  }
  if (path) {
    db.data.programs[programIndex].path = path;
  }
  
  db.write();
  res.json({ success: true, program: db.data.programs[programIndex] });
});

app.delete('/api/programs/:id', authenticateUser, (req, res) => {
  const { id } = req.params;
  const programCount = db.data.programs.length;
  
  if (programCount <= 1) {
    return res.status(400).json({ error: '至少保留一个程序' });
  }
  
  db.data.programs = db.data.programs.filter(p => p.id !== parseInt(id));
  db.write();
  res.json({ success: true, message: '删除成功' });
});

app.get('/api/programs-list', (req, res) => {
  res.json(db.data.programs);
});

app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});
