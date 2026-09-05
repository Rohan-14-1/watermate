const multer = require("multer");
const path = require("path");

const MAX_CHAT_FILE_SIZE = 15 * 1024 * 1024; // 15 MB

const ALLOWED_MIME_TYPES = new Set([
  // Images
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  // Videos
  "video/mp4",
  "video/webm",
  "video/quicktime",
  // Documents
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function getFileTypeCategory(mimeType) {
  if (mimeType.startsWith("image/")) return "IMAGE";
  if (mimeType.startsWith("video/")) return "VIDEO";
  return "DOCUMENT";
}

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CHAT_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype.toLowerCase())) {
      const err = new Error("INVALID_FILE_TYPE");
      err.code = "INVALID_FILE_TYPE";
      return cb(err);
    }
    cb(null, true);
  },
});

function handleChatAttachmentUpload(req, res, next) {
  const single = memoryUpload.single("file");
  single(req, res, (err) => {
    if (err) {
      if (err.code === "INVALID_FILE_TYPE") {
        return res.status(400).json({
          message: "Unsupported file type. Allowed types: JPG, PNG, WebP, GIF, MP4, WebM, MOV, PDF, TXT, DOCX.",
        });
      }
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          message: "File is too large. Maximum allowed size is 15MB.",
        });
      }
      return res.status(400).json({ message: err.message || "Failed to process file upload." });
    }
    if (!req.file) {
      return res.status(400).json({ message: "No file provided." });
    }
    req.fileTypeCategory = getFileTypeCategory(req.file.mimetype.toLowerCase());
    next();
  });
}

module.exports = { handleChatAttachmentUpload, getFileTypeCategory };
