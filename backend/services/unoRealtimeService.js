/**
 * WaterMate UNO Realtime Service
 * Dual-engine multiplayer broadcasting:
 * 1. Supabase Realtime Broadcast (Primary production)
 * 2. Server-Sent Events (SSE) with heartbeat (Local dev, direct mobile/web fallback)
 */

class UnoRealtimeService {
  constructor() {
    this.sseClients = new Map(); // gameId -> Set of res objects
    this.supabaseUrl = (process.env.SUPABASE_URL || "").trim();
    this.supabaseKey = (
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_KEY ||
      ""
    ).trim();

    // Heartbeat timer to prevent timeout drops on proxies/mobile networks
    setInterval(() => {
      this.sendHeartbeats();
    }, 25000);
  }

  isSupabaseConfigured() {
    return Boolean(this.supabaseUrl && this.supabaseKey);
  }

  getPublicConfig() {
    return {
      supabaseUrl: this.supabaseUrl || null,
      supabaseAnonKey: (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || "").trim() || null,
      hasRealtime: this.isSupabaseConfigured()
    };
  }

  /**
   * Register SSE response stream for a player in a game
   */
  addSseClient(gameId, userId, res) {
    if (!this.sseClients.has(gameId)) {
      this.sseClients.set(gameId, new Set());
    }
    const clientRecord = { res, userId, connectedAt: Date.now() };
    const set = this.sseClients.get(gameId);
    set.add(clientRecord);

    // Initial handshake
    res.write(`event: connected\ndata: ${JSON.stringify({ gameId, timestamp: Date.now() })}\n\n`);

    res.on("close", () => {
      set.delete(clientRecord);
      if (set.size === 0) {
        this.sseClients.delete(gameId);
      }
    });
  }

  /**
   * Sends heartbeat ping to all active SSE clients
   */
  sendHeartbeats() {
    for (const [gameId, clients] of this.sseClients.entries()) {
      for (const client of clients) {
        try {
          client.res.write(": heartbeat\n\n");
        } catch (_) {
          clients.delete(client);
        }
      }
      if (clients.size === 0) {
        this.sseClients.delete(gameId);
      }
    }
  }

  /**
   * Broadcasts authoritative safe game update to all players
   * @param {string} gameId
   * @param {Object} eventData - { gameId, turnNumber, version, status, currentPlayerId, currentColor, lastAction }
   */
  async broadcastGameUpdate(gameId, eventData) {
    const payload = {
      type: "GAME_UPDATED",
      gameId,
      timestamp: Date.now(),
      ...eventData
    };

    // 1. Dispatch to local/SSE clients
    const clients = this.sseClients.get(gameId);
    if (clients && clients.size > 0) {
      const message = `event: game_update\ndata: ${JSON.stringify(payload)}\n\n`;
      for (const client of clients) {
        try {
          client.res.write(message);
        } catch (err) {
          clients.delete(client);
        }
      }
    }

    // 2. Dispatch via Supabase Realtime REST broadcast if configured
    if (this.isSupabaseConfigured()) {
      try {
        const broadcastUrl = `${this.supabaseUrl.replace(/\/+$/, "")}/realtime/v1/api/broadcast`;
        const response = await fetch(broadcastUrl, {
          method: "POST",
          headers: {
            apikey: this.supabaseKey,
            Authorization: `Bearer ${this.supabaseKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messages: [
              {
                topic: `room:uno_${gameId}`,
                event: "game_update",
                payload
              }
            ]
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          // Non-fatal, SSE already notified connected clients
          console.warn(`[UnoRealtime] Supabase broadcast returned ${response.status}:`, errText);
        }
      } catch (err) {
        console.warn("[UnoRealtime] Supabase broadcast error:", err.message);
      }
    }
  }
}

const unoRealtimeService = new UnoRealtimeService();
module.exports = unoRealtimeService;
