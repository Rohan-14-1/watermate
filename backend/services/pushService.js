const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const path = require("path");
const fs = require("fs");
const prisma = require("../prisma/client");

/**
 * PushService handles dispatching push notifications to registered devices.
 * Uses Firebase Admin SDK for modern FCM HTTP v1 / APNs delivery.
 * Automatically removes unregistered/expired tokens.
 */
class PushService {
  constructor() {
    this.fcmServerKey = process.env.FCM_SERVER_KEY || "";
    this.adminInitialized = false;
    this.messaging = null;
    this.initFirebaseAdmin();
  }

  initFirebaseAdmin() {
    if (getApps().length > 0) {
      this.adminInitialized = true;
      this.messaging = getMessaging();
      return;
    }

    try {
      let serviceAccount = null;

      // 1. Check FIREBASE_SERVICE_ACCOUNT environment variable (file path or inline JSON)
      const envCred = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (envCred) {
        if (envCred.trim().startsWith("{")) {
          serviceAccount = JSON.parse(envCred);
        } else if (fs.existsSync(envCred)) {
          serviceAccount = JSON.parse(fs.readFileSync(envCred, "utf8"));
        }
      }

      // 2. Check local standard file locations
      if (!serviceAccount) {
        const potentialPaths = [
          path.join(__dirname, "../firebase-service-account.json"),
          path.join(__dirname, "../../firebase-service-account.json"),
        ];
        for (const p of potentialPaths) {
          if (fs.existsSync(p)) {
            serviceAccount = JSON.parse(fs.readFileSync(p, "utf8"));
            break;
          }
        }
      }

      if (serviceAccount && serviceAccount.project_id && serviceAccount.private_key) {
        initializeApp({
          credential: cert(serviceAccount),
        });
        this.adminInitialized = true;
        this.messaging = getMessaging();
        console.log(`[PushService] Firebase Admin initialized for project "${serviceAccount.project_id}".`);
      }
    } catch (err) {
      console.warn("[PushService] Failed to initialize Firebase Admin:", err.message);
    }
  }

  isConfigured() {
    return this.adminInitialized || Boolean(this.fcmServerKey);
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

      // Format data values as strings (FCM requirement: all data values must be strings)
      const stringData = {};
      for (const [k, v] of Object.entries(data || {})) {
        stringData[k] = typeof v === "string" ? v : JSON.stringify(v);
      }
      stringData.title = title || "";
      stringData.body = body || "";

      // 1. Prefer modern Firebase Admin SDK
      if (this.adminInitialized && this.messaging) {
        for (const token of tokens) {
          try {
            await this.messaging.send({
              token,
              notification: {
                title,
                body,
              },
              data: stringData,
              android: {
                priority: "high",
                notification: {
                  channelId: "water_turns",
                  sound: "default",
                  defaultSound: true,
                  defaultVibrateTimings: true,
                  priority: "high",
                },
              },
              apns: {
                headers: {
                  "apns-priority": "10",
                },
                payload: {
                  aps: {
                    alert: {
                      title,
                      body,
                    },
                    sound: "default",
                    badge: 1,
                  },
                },
              },
            });
          } catch (sendErr) {
            const code = sendErr.code || "";
            if (
              code === "messaging/registration-token-not-registered" ||
              code === "messaging/invalid-registration-token" ||
              code === "messaging/invalid-argument"
            ) {
              await this.removeInvalidToken(token);
            } else {
              console.warn(`[PushService] Send error to token ${token.slice(0, 10)}...:`, sendErr.message);
            }
          }
        }
        return;
      }

      // 2. Fallback to legacy FCM server key if configured
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
                data: { ...stringData, title, body },
              }),
            });

            if (res.status === 400 || res.status === 404) {
              await this.removeInvalidToken(token);
            } else {
              const resJson = await res.json().catch(() => ({}));
              if (
                resJson?.results?.[0]?.error === "NotRegistered" ||
                resJson?.results?.[0]?.error === "InvalidRegistration"
              ) {
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
