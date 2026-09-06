const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * StorageService provides persistent object storage for chat attachments and media.
 *
 * Priority:
 * 1. Supabase Storage (if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY are provided)
 * 2. S3-compatible storage (if S3_BUCKET and S3_ENDPOINT/AWS credentials are provided)
 * 3. Local disk fallback (backend/uploads/chat) for offline/local development
 */

const LOCAL_CHAT_UPLOADS_DIR = process.env.VERCEL
  ? path.join("/tmp", "uploads", "chat")
  : path.join(__dirname, "..", "uploads", "chat");

if (!fs.existsSync(LOCAL_CHAT_UPLOADS_DIR)) {
  fs.mkdirSync(LOCAL_CHAT_UPLOADS_DIR, { recursive: true });
}

class StorageService {
  constructor() {
    this.supabaseUrl = process.env.SUPABASE_URL || "";
    this.supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_KEY ||
      "";
    this.supabaseBucket = process.env.SUPABASE_STORAGE_BUCKET || "watermate-chat";
    this.supabaseWaterBucket = process.env.SUPABASE_WATER_BUCKET || "water-deliveries";
  }

  isSupabaseConfigured() {
    return Boolean(this.supabaseUrl && this.supabaseKey);
  }

  isProduction() {
    return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
  }

  /**
   * Uploads a water delivery photo to persistent Supabase Storage.
   * In production, requires Supabase Storage configuration and fails clearly if missing.
   * Local storage fallback is only permitted in local development.
   * @param {Object} params - { buffer, originalName, mimeType, groupId }
   * @returns {Promise<{ photoUrl: string, storagePath: string, key: string }>}
   */
  async uploadWaterPhoto({ buffer, originalName, mimeType, groupId }) {
    if (this.isProduction() && !this.isSupabaseConfigured()) {
      const err = new Error("Storage service is not configured. Supabase credentials are required in production.");
      err.code = "STORAGE_NOT_CONFIGURED";
      err.status = 500;
      throw err;
    }

    const ext = path.extname(originalName).toLowerCase() || ".jpg";
    const uniqueId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
    const safeGroupId = (groupId || "default").replace(/[^a-zA-Z0-9_-]/g, "");
    const key = `${safeGroupId}/${Date.now()}-${uniqueId}${ext}`;
    const bucket = this.supabaseWaterBucket;

    if (this.isSupabaseConfigured()) {
      const uploadUrl = `${this.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${bucket}/${key}`;
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.supabaseKey}`,
          apikey: this.supabaseKey,
          "Content-Type": mimeType || "image/jpeg",
          "x-upsert": "false",
        },
        body: buffer,
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[StorageService] Supabase upload failed (${response.status}):`, errText);

        if (response.status === 404 || errText.includes("Bucket not found") || errText.includes("not found")) {
          const err = new Error(`Water photo storage is not configured. Storage bucket '${bucket}' not found.`);
          err.code = "BUCKET_NOT_FOUND";
          err.status = 500;
          throw err;
        }

        if (this.isProduction()) {
          const err = new Error("Failed to store water delivery photo in cloud storage.");
          err.code = "STORAGE_UPLOAD_FAILED";
          err.status = 500;
          throw err;
        }

        console.warn("[StorageService] Falling back to local storage in development mode.");
        return this._uploadWaterPhotoLocal(buffer, ext);
      }

      // Public bucket permanent CDN URL
      const publicUrl = `${this.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${key}`;
      return {
        photoUrl: publicUrl,
        storagePath: `supabase://${bucket}/${key}`,
        key,
      };
    }

    // Local development fallback
    return this._uploadWaterPhotoLocal(buffer, ext);
  }

  _uploadWaterPhotoLocal(buffer, ext) {
    const localDir = process.env.VERCEL
      ? path.join("/tmp", "uploads")
      : path.join(__dirname, "..", "uploads");
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
    const filename = `water-${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
    fs.writeFileSync(path.join(localDir, filename), buffer);
    return {
      photoUrl: `/uploads/${filename}`,
      storagePath: `local://${filename}`,
      key: filename,
    };
  }

  /**
   * Deletes a water delivery photo from storage (used for transactional compensation cleanup).
   * @param {string} storagePath - e.g. "supabase://water-deliveries/group/file.jpg"
   */
  async deleteWaterPhoto(storagePath) {
    if (!storagePath) return;

    if (storagePath.startsWith("supabase://")) {
      const parts = storagePath.replace("supabase://", "").split("/");
      const bucket = parts[0];
      const key = parts.slice(1).join("/");

      if (this.isSupabaseConfigured()) {
        try {
          const deleteUrl = `${this.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${bucket}`;
          const res = await fetch(deleteUrl, {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${this.supabaseKey}`,
              apikey: this.supabaseKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ prefixes: [key] }),
          });
          if (!res.ok) {
            const errText = await res.text();
            console.warn(`[StorageService] Failed to clean up photo '${key}' from Supabase:`, errText);
          }
        } catch (err) {
          console.error(`[StorageService] Error during orphan photo cleanup for '${key}':`, err.message);
        }
      }
      return;
    }

    if (storagePath.startsWith("local://")) {
      const localDir = process.env.VERCEL
        ? path.join("/tmp", "uploads")
        : path.join(__dirname, "..", "uploads");
      const filename = storagePath.replace("local://", "");
      const filePath = path.join(localDir, filename);
      if (fs.existsSync(filePath)) {
        fs.unlink(filePath, () => {});
      }
    }
  }

  /**
   * Uploads file buffer to persistent storage.
   * @param {Object} params - { buffer, originalName, mimeType, prefix }
   * @returns {Promise<{ storagePath: string, fileName: string, fileSize: number, mimeType: string, url: string }>}
   */
  async uploadFile({ buffer, originalName, mimeType, prefix = "chat" }) {
    const ext = path.extname(originalName).toLowerCase();
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
    const safeName = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
    const key = `${prefix}/${uniqueSuffix}_${safeName}${ext}`;

    if (this.isSupabaseConfigured()) {
      try {
        const uploadUrl = `${this.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${this.supabaseBucket}/${key}`;
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.supabaseKey}`,
            apikey: this.supabaseKey,
            "Content-Type": mimeType,
            "x-upsert": "true",
          },
          body: buffer,
        });

        if (!response.ok) {
          const errText = await response.text();
          console.warn("[StorageService] Supabase upload failed, falling back to local:", errText);
          return this._uploadLocal(buffer, key, originalName, mimeType);
        }

        return {
          storagePath: `supabase://${this.supabaseBucket}/${key}`,
          fileName: originalName,
          fileSize: buffer.length,
          mimeType,
          key,
        };
      } catch (err) {
        console.warn("[StorageService] Supabase upload error, falling back to local:", err.message);
        return this._uploadLocal(buffer, key, originalName, mimeType);
      }
    }

    // Local disk storage fallback
    return this._uploadLocal(buffer, key, originalName, mimeType);
  }

  _uploadLocal(buffer, key, originalName, mimeType) {
    const filePath = path.join(LOCAL_CHAT_UPLOADS_DIR, path.basename(key));
    fs.writeFileSync(filePath, buffer);
    return {
      storagePath: `local://${path.basename(key)}`,
      fileName: originalName,
      fileSize: buffer.length,
      mimeType,
      key: path.basename(key),
    };
  }

  /**
   * Deletes a file from persistent storage.
   * @param {string} storagePath - e.g. "supabase://bucket/key" or "local://filename"
   */
  async deleteFile(storagePath) {
    if (!storagePath) return;

    if (storagePath.startsWith("supabase://")) {
      const parts = storagePath.replace("supabase://", "").split("/");
      const bucket = parts[0];
      const key = parts.slice(1).join("/");

      if (this.isSupabaseConfigured()) {
        try {
          const deleteUrl = `${this.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${bucket}`;
          await fetch(deleteUrl, {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${this.supabaseKey}`,
              apikey: this.supabaseKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ prefixes: [key] }),
          });
        } catch (err) {
          console.warn("[StorageService] Failed to delete from Supabase storage:", err.message);
        }
      }
      return;
    }

    if (storagePath.startsWith("local://")) {
      const fileName = storagePath.replace("local://", "");
      const filePath = path.join(LOCAL_CHAT_UPLOADS_DIR, fileName);
      if (fs.existsSync(filePath)) {
        fs.unlink(filePath, () => {});
      }
    }
  }

  /**
   * Retrieves a readable file stream or binary buffer for authenticated streaming.
   * @param {string} storagePath
   * @returns {Promise<{ buffer: Buffer | null, redirectUrl: string | null, mimeType: string | null }>}
   */
  async getFile(storagePath, mimeType = "application/octet-stream") {
    if (!storagePath) return { buffer: null, redirectUrl: null, mimeType };

    if (storagePath.startsWith("supabase://")) {
      const parts = storagePath.replace("supabase://", "").split("/");
      const bucket = parts[0];
      const key = parts.slice(1).join("/");

      if (this.isSupabaseConfigured()) {
        try {
          // Generate a temporary signed URL (valid for 10 minutes) for secure access
          const signUrl = `${this.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/sign/${bucket}/${key}`;
          const signRes = await fetch(signUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.supabaseKey}`,
              apikey: this.supabaseKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ expiresIn: 600 }),
          });

          if (signRes.ok) {
            const data = await signRes.json();
            if (data?.signedURL) {
              const fullUrl = `${this.supabaseUrl.replace(/\/+$/, "")}/storage/v1${data.signedURL}`;
              return { buffer: null, redirectUrl: fullUrl, mimeType };
            }
          }

          // Fallback: fetch binary directly
          const downloadUrl = `${this.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${bucket}/${key}`;
          const getRes = await fetch(downloadUrl, {
            headers: {
              Authorization: `Bearer ${this.supabaseKey}`,
              apikey: this.supabaseKey,
            },
          });
          if (getRes.ok) {
            const arrayBuf = await getRes.arrayBuffer();
            return { buffer: Buffer.from(arrayBuf), redirectUrl: null, mimeType };
          }
        } catch (err) {
          console.warn("[StorageService] Error reading from Supabase storage:", err.message);
        }
      }
    }

    if (storagePath.startsWith("local://")) {
      const fileName = storagePath.replace("local://", "");
      const filePath = path.join(LOCAL_CHAT_UPLOADS_DIR, fileName);
      if (fs.existsSync(filePath)) {
        return { buffer: fs.readFileSync(filePath), redirectUrl: null, mimeType };
      }
    }

    return { buffer: null, redirectUrl: null, mimeType };
  }
}

module.exports = new StorageService();
