const multer = require("multer");

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

// 4 MB application-level limit ensures total multipart request remains well below Vercel's payload ceiling
const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024;

const storage = multer.memoryStorage();

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype ? file.mimetype.toLowerCase() : "")) {
    const err = new Error("INVALID_FILE_TYPE");
    err.code = "INVALID_FILE_TYPE";
    return cb(err);
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

/**
 * Validates actual binary file signatures (magic bytes) to prevent disguised files.
 */
function isValidImageSignature(buffer) {
  if (!buffer || buffer.length < 12) return false;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return true;
  }
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return true;
  }
  // WebP: RIFF .... WEBP
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return true;
  }
  return false;
}

/**
 * Wraps multer's single-file upload so multer errors (bad type, too large)
 * turn into consistent, friendly JSON error responses.
 */
function handleWaterPhotoUpload(req, res, next) {
  const single = upload.single("photo");
  single(req, res, (err) => {
    if (err) {
      if (err.code === "INVALID_FILE_TYPE" || err.message === "INVALID_FILE_TYPE") {
        return res.status(400).json({
          message: "Invalid image format. Allowed formats: JPG, PNG, or WebP.",
        });
      }
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          message: "Image is too large. Maximum size is 4MB.",
        });
      }
      return res.status(400).json({ message: "Unable to process photo upload." });
    }

    if (req.file && req.file.buffer) {
      if (!isValidImageSignature(req.file.buffer)) {
        return res.status(400).json({
          message: "Invalid or corrupted image file content. Please choose a valid JPG, PNG, or WebP photo.",
        });
      }
    }

    next();
  });
}

module.exports = { handleWaterPhotoUpload };

