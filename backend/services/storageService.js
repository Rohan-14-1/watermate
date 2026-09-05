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
  }

  isSupabaseConfigured() {
    return Boolean(this.supabaseUrl && this.supabaseKey);
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
