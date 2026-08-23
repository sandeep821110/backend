import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";

// Enhanced file filter
const fileFilter = (req, file, cb) => {
  if (!file.mimetype?.startsWith('image/')) {
    return cb(new Error('Only image files are allowed!'), false);
  }

  const allowedExtensions = ['jpg', 'jpeg', 'png', 'webp'];
  const fileExtension = (file.originalname || '').split('.').pop().toLowerCase();
  if (!allowedExtensions.includes(fileExtension)) {
    return cb(new Error(`Invalid file type. Allowed: ${allowedExtensions.join(', ')}`), false);
  }
  cb(null, true);
};

// Enhanced upload middleware
// opts: { folder, prefix, width, height } let each route control Cloudinary params
const upload = (fieldName, maxCount = 5, opts = {}) => {
  const {
    folder = 'products',
    prefix = 'product',
    width = 800,
    height = 800
  } = opts;

  return (req, res, next) => {
    const storage = new CloudinaryStorage({
      cloudinary,
      params: {
        folder,
        allowed_formats: ["jpg", "png", "jpeg", "webp"],
        transformation: [
          { width, height, crop: "limit" },
          { quality: "auto" }
        ],
        public_id: (req, file) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
          return `${prefix}-${uniqueSuffix}`;
        }
      },
    });

    const uploadInstance = multer({
      storage,
      fileFilter,
      limits: { fileSize: 5 * 1024 * 1024, files: maxCount }
    }).array(fieldName, maxCount);

    uploadInstance(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        let message = 'File upload error';
        switch (err.code) {
          case 'LIMIT_FILE_SIZE': message = 'File is too large. Max 5MB'; break;
          case 'LIMIT_FILE_COUNT': message = `Max ${maxCount} images allowed`; break;
          case 'LIMIT_UNEXPECTED_FILE': message = `Unexpected field. Use '${fieldName}'`; break;
        }
        return res.status(400).json({ success: false, message, error: err.code });
      }

      if (err) {
        console.error('Upload error:', err);
        return res.status(400).json({ success: false, message: err.message || 'Upload failed' });
      }

      // do NOT auto-return 400 here — let controller validate presence
      if (!req.files || req.files.length === 0) {
        req.filesMissing = true;
        // add debug info for controller
        req.uploadDebug = { contentType: req.headers['content-type'] || '' };
        return next();
      }

      console.log('Files uploaded:', (req.files || []).map(f => f.originalname));
      next();
    });
  };
};

export default upload;
