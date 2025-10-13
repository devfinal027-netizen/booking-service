const multer = require("multer");
const path = require("path");
const fs = require("fs");

const UPLOADS_FOLDER = path.join(process.cwd(), "uploads");

// Common MIME types for validation
const MIME_TYPES = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/pjpeg": "jpg",
  "image/png": "png",
  "image/x-png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
};

const createUploader = (options = {}) => {
  const {
    subfolder = null,
    allowedMimeTypes = Object.keys(MIME_TYPES),
    maxFileSizeMB = null,
  } = options;

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dynamicSubfolder = subfolder || req.baseUrl.split("/").pop();
      const destinationFolder = path.join(UPLOADS_FOLDER, dynamicSubfolder);

      fs.mkdirSync(destinationFolder, { recursive: true });
      cb(null, destinationFolder);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const fileExt =
        path.extname(file.originalname) || `.${MIME_TYPES[file.mimetype]}`;
      const safeFilename = file.originalname.replace(/[^a-zA-Z0-9.]/g, "_");
      cb(null, `${safeFilename}-${uniqueSuffix}${fileExt}`);
    },
  });

  const fileFilter = (req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      const allowedTypesString = allowedMimeTypes.join(", ");
      cb(
        new Error(`Invalid file type. Allowed types: ${allowedTypesString}`),
        false
      );
    }
  };

  return multer({
    storage,
    fileFilter,
    limits: {
      fileSize: maxFileSizeMB * 1024 * 1024,
    },
  });
};

module.exports = { createUploader, MIME_TYPES };
