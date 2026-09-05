const prisma = require("../prisma/client");

/**
 * PushService handles dispatching push notifications to registered devices.
 * Reads credentials strictly from server-side environment variables.
 * Automatically removes unregistered/expired tokens.
 */
class PushService {
  constructor() {
    this.fcmServerKey = process.env.FCM_SERVER_KEY || "";
    this.firebaseServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT || "";
  }

  isConfigured() {
    return Boolean(this.fcmServerKey || this.firebaseServiceAccount);
  }

  /**
   * Dispatches push notification to all active devices of a user.
   * @param {string} userId
   * @param {Object} payload - { title, body, data }
   */
  async sendToUser(userId, { title, body, data = {} }) {
    if (!userId) return;

    try {
      const devices = await prisma.userDevice.findMany({
        where: { userId },
      });

      if (devices.length === 0) {
        return;
      }

      const tokens = devices.map((d) => d.token);

      if (!this.isConfigured()) {
        console.log(`[PushService] Simulated push to user ${userId} (${tokens.length} devices): "${title}" - "${body}"`);
        return;
      }

      // If legacy or standard FCM key is provided
      if (this.fcmServerKey) {
        for (const token of tokens) {
          try {
            const res = await fetch("https://fcm.googleapis.com/fcm/send", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `key=${this.fcmServerKey}`,
              },
              body: JSON.stringify({
                to: token,
                notification: {
                  title,
                  body,
                  sound: "default",
                  android_channel_id: "water_turns",
                },
                data: { ...data, title, body },
              }),
            });

            if (res.status === 400 || res.status === 404) {
              await this.removeInvalidToken(token);
            } else {
              const resJson = await res.json().catch(() => ({}));
              if (resJson?.results?.[0]?.error === "NotRegistered" || resJson?.results?.[0]?.error === "InvalidRegistration") {
                await this.removeInvalidToken(token);
              }
            }
          } catch (tokenErr) {
            console.warn(`[PushService] Failed sending to token ${token.slice(0, 10)}...:`, tokenErr.message);
          }
        }
      }
    } catch (err) {
      console.warn("[PushService] Push dispatch failed:", err.message);
    }
  }

  async removeInvalidToken(token) {
    try {
      await prisma.userDevice.deleteMany({
        where: { token },
      });
      console.log(`[PushService] Removed invalid/expired device token: ${token.slice(0, 12)}...`);
    } catch (_) {}
  }
}

module.exports = new PushService();
