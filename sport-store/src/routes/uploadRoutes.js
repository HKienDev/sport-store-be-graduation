import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import * as uploadController from '../controllers/uploadController.js';
import { verifyUser, verifyAdmin } from '../middlewares/authMiddleware.js';
import fs from 'fs';
import { validateRequest } from '../middlewares/validateRequest.js';
import { uploadFileSchema } from '../schemas/uploadSchema.js';
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../utils/constants.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cấu hình multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../../uploads/');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Thêm timestamp và random string để tránh trùng tên file
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // Giới hạn 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Loại file không được hỗ trợ. Chỉ chấp nhận JPG, PNG, GIF và WEBP.'));
    }
  }
});

// Middleware xử lý lỗi multer
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('Multer error:', err);
    return res.status(400).json({
      success: false,
      error: 'Lỗi khi upload file',
      details: err.message
    });
  } else if (err) {
    console.error('Upload error:', err);
    return res.status(400).json({
      success: false,
      error: 'Lỗi khi upload file',
      details: err.message
    });
  }
  next();
};

// Public routes
router.get("/test", (req, res) => {
    res.json({ message: SUCCESS_MESSAGES.ROUTE_WORKING });
});

// Upload routes với multer
router.post('/avatar', 
  verifyUser,
  upload.single('file'),
  handleMulterError,
  validateRequest(uploadFileSchema),
  uploadController.uploadAvatar
);

router.post('/product', 
  verifyAdmin,
  upload.single('file'),
  handleMulterError,
  validateRequest(uploadFileSchema),
  uploadController.uploadProductImage
);

export default router; 