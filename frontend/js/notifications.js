/**
 * WaterMate 2.0 Notification Manager
 * Handles in-app notification center, unread badges, manual team notifications,
 * and Capacitor push notification registration.
 */

(function () {
  let activeGroupId = null;
  let pollInterval = null;
  let unreadCount = 0;
  let groupMembers = [];

  function getApi() {
    if (typeof window !== "undefined" && window.Api) return window.Api;
    if (typeof Api !== "undefined") return Api;
    return null;
  }

  // Initialize once DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initNotificationManager);
  } else {
    initNotificationManager();
  }

  function initNotificationManager() {
    activeGroupId = localStorage.getItem("wm_active_group");
    injectNotificationUI();
    bindEvents();
    loadUnreadCount();
    setupPushNotifications();

    // Poll for notifications every 25 seconds if active
    if (!pollInterval) {
      pollInterval = setInterval(loadUnreadCount, 25000);
    }
  }

  function injectNotificationUI() {
    // 1. Inject Notification Bell into Topbar
    const userBox = document.getElementById("userBox");
    if (userBox && !document.getElementById("wmNotifBtn")) {
      const bellBtn = document.createElement("button");
      bellBtn.id = "wmNotifBtn";
      bellBtn.className = "topbar__icon-btn";
      bellBtn.type = "button";
      bellBtn.setAttribute("aria-label", "Notifications");
      bellBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>
        <span class="notif-badge" id="wmNotifBadge" style="display:none;">0</span>
      `;
      userBox.parentNode.insertBefore(bellBtn, userBox);
    }

    // 2. Inject Notification Center Modal if missing
    if (!document.getElementById("wmNotifCenterModal")) {
      const notifModal = document.createElement("div");
      notifModal.id = "wmNotifCenterModal";
      notifModal.className = "wm-modal-overlay";
      notifModal.hidden = true;
      notifModal.innerHTML = `
        <div class="wm-modal">
          <div class="wm-modal__head">
            <h3>Notifications</h3>
            <button type="button" class="wm-modal__close" id="wmNotifClose" aria-label="Close">&times;</button>
          </div>
          <div class="wm-modal__body">
            <div class="notif-center-actions">
              <button type="button" class="btn btn-secondary" id="wmOpenSendAlertBtn" style="flex:1; padding:8px 12px; font-size:0.85rem;">
                📢 Send Team Alert
              </button>
              <button type="button" class="btn btn-outline" id="wmMarkAllReadBtn" style="padding:8px 12px; font-size:0.85rem;">
                Mark all read
              </button>
            </div>
            <div id="wmNotifList" class="notif-list">
              <div class="notif-empty">
                <div class="notif-empty__icon">💧</div>
                <p>Loading notifications&hellip;</p>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(notifModal);
    }

    // 3. Inject Send Team Notification Modal if missing
    if (!document.getElementById("wmSendNotifModal")) {
      const sendModal = document.createElement("div");
      sendModal.id = "wmSendNotifModal";
      sendModal.className = "wm-modal-overlay";
      sendModal.hidden = true;
      sendModal.innerHTML = `
        <div class="wm-modal">
          <div class="wm-modal__head">
            <h3>Send Team Notification</h3>
            <button type="button" class="wm-modal__close" id="wmSendNotifClose" aria-label="Close">&times;</button>
          </div>
          <form id="wmSendNotifForm" class="send-notif-form">
            <div class="wm-modal__body">
              <div class="field">
                <label for="wmNotifRecipient">Send to</label>
                <select id="wmNotifRecipient" required>
                  <option value="ALL">Entire Team (Everyone)</option>
                </select>
              </div>
              <div class="field">
                <label for="wmNotifTitle">Title</label>
                <input type="text" id="wmNotifTitle" placeholder="e.g. Water delivery reminder" required maxlength="80" />
              </div>
              <div class="field">
                <label for="wmNotifMessage">Message</label>
                <textarea id="wmNotifMessage" placeholder="Type an urgent message or reminder for your team..." required maxlength="400"></textarea>
              </div>
              <p style="font-size:0.75rem; color:var(--ink-soft); margin-top:4px;">
                Instant push & in-app notification will be sent. Limited to 10 alerts per 10 minutes.
              </p>
              <div id="wmSendNotifStatus" style="display:none; margin-top:8px; font-size:0.85rem;"></div>
            </div>
            <div class="wm-modal__footer">
              <button type="button" class="btn btn-secondary" id="wmSendNotifCancel">Cancel</button>
              <button type="submit" class="btn btn-primary" id="wmSendNotifSubmit">Send Notification</button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(sendModal);
    }
  }

  function bindEvents() {
    // Bell click -> Open Notification Center
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("#wmNotifBtn");
      if (btn) {
        e.preventDefault();
        openNotificationCenter();
      }
    });

    // Close Notification Center
    document.addEventListener("click", (e) => {
      if (e.target.id === "wmNotifClose" || e.target.id === "wmNotifCenterModal") {
        closeNotificationCenter();
      }
    });

    // Open Send Alert Modal from Notification Center
    document.addEventListener("click", (e) => {
      if (e.target.closest("#wmOpenSendAlertBtn")) {
        closeNotificationCenter();
        openSendNotificationModal();
      }
    });

    // Close Send Alert Modal
    document.addEventListener("click", (e) => {
      if (e.target.id === "wmSendNotifClose" || e.target.id === "wmSendNotifCancel" || e.target.id === "wmSendNotifModal") {
        closeSendNotificationModal();
      }
    });

    // Mark All Read
    document.addEventListener("click", async (e) => {
      if (e.target.closest("#wmMarkAllReadBtn")) {
        await markAllRead();
      }
    });

    // Submit Send Notification Form
    document.addEventListener("submit", async (e) => {
      if (e.target.id === "wmSendNotifForm") {
        e.preventDefault();
        await handleSendNotificationSubmit();
      }
    });
  }

  async function loadUnreadCount() {
    activeGroupId = localStorage.getItem("wm_active_group");
    const api = getApi();
    if (!activeGroupId || !api || typeof api.listNotifications !== "function") return;

    try {
      const data = await api.listNotifications(activeGroupId, 1);
      unreadCount = data.unreadCount || 0;
      updateBadgeUI();
    } catch (err) {
      // Quiet fail on network hiccups
    }
  }

  function updateBadgeUI() {
    const badge = document.getElementById("wmNotifBadge");
    if (!badge) return;

    if (unreadCount > 0) {
      badge.textContent = unreadCount > 99 ? "99+" : unreadCount;
      badge.style.display = "flex";
    } else {
      badge.style.display = "none";
    }
  }

  async function openNotificationCenter() {
    const modal = document.getElementById("wmNotifCenterModal");
    if (!modal) return;
    modal.hidden = false;
    await renderNotifications();
  }

  function closeNotificationCenter() {
    const modal = document.getElementById("wmNotifCenterModal");
    if (modal) modal.hidden = true;
  }

  async function renderNotifications() {
    const listEl = document.getElementById("wmNotifList");
    if (!listEl) return;

    activeGroupId = localStorage.getItem("wm_active_group");
    if (!activeGroupId) {
      listEl.innerHTML = `
        <div class="notif-empty">
          <div class="notif-empty__icon">🏝️</div>
          <p>Please select or join a team first.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = `
      <div class="notif-empty">
        <div class="spinner" style="margin:0 auto 12px;"></div>
        <p>Loading notifications&hellip;</p>
      </div>
    `;

    try {
      const data = await window.Api.listNotifications(activeGroupId, 1);
      unreadCount = data.unreadCount || 0;
      updateBadgeUI();

      if (!data.notifications || data.notifications.length === 0) {
        listEl.innerHTML = `
          <div class="notif-empty">
            <div class="notif-empty__icon">✨</div>
            <p>You're all caught up!</p>
            <span style="font-size:0.78rem; opacity:0.7;">No new turn reminders or alerts.</span>
          </div>
        `;
        return;
      }

      listEl.innerHTML = data.notifications
        .map((n) => {
          const isTurn = n.type === "WATER_TURN";
          const icon = isTurn ? "💧" : "📢";
          const timeAgo = formatTimeAgo(n.createdAt);
          const unreadClass = n.isRead ? "" : "is-unread";
          const dot = n.isRead ? "" : `<span class="notif-item__unread-dot"></span>`;

          return `
            <div class="notif-item ${unreadClass} ${isTurn ? "is-turn" : ""}" data-id="${n.id}" data-read="${n.isRead}">
              <div class="notif-item__icon">${icon}</div>
              <div class="notif-item__content">
                <div class="notif-item__title">
                  ${escapeHtml(n.title)}
                  ${isUnread ? `<span class="notif-item__unread-dot"></span>` : ""}
                </div>
                <div class="notif-item__body">${escapeHtml(n.body)}</div>
                <div class="notif-item__time">${formatTimeAgo(n.createdAt)}</div>
              </div>
            </div>
          `;
        })
        .join("");

      // Bind click on items to mark as read
      listEl.querySelectorAll(".notif-item").forEach((el) => {
        el.addEventListener("click", async () => {
          const id = el.getAttribute("data-id");
          const isRead = el.getAttribute("data-read") === "true";
          if (!isRead) {
            el.classList.remove("is-unread");
            el.setAttribute("data-read", "true");
            const dot = el.querySelector(".notif-item__unread-dot");
            if (dot) dot.remove();
            unreadCount = Math.max(0, unreadCount - 1);
            updateBadgeUI();
            try {
              const api = getApi();
              if (api) await api.markNotificationRead(activeGroupId, id);
            } catch (e) {
              console.warn("Could not mark notif read on server:", e);
            }
          }
        });
      });
    } catch (err) {
      listEl.innerHTML = `
        <div class="notif-empty">
          <div class="notif-empty__icon">⚠️</div>
          <p>Failed to load notifications.</p>
          <span style="font-size:0.75rem; color:var(--coral-500);">${escapeHtml(err.message)}</span>
        </div>
      `;
    }
  }

  async function markAllRead() {
    activeGroupId = localStorage.getItem("wm_active_group");
    const api = getApi();
    if (!activeGroupId || !api || typeof api.markAllNotificationsRead !== "function") return;

    try {
      await api.markAllNotificationsRead(activeGroupId);
      unreadCount = 0;
      updateBadgeUI();
      const unreadItems = document.querySelectorAll("#wmNotifList .notif-item.is-unread");
      unreadItems.forEach((item) => {
        item.classList.remove("is-unread");
        item.setAttribute("data-read", "true");
        const dot = item.querySelector(".notif-item__unread-dot");
        if (dot) dot.remove();
      });
    } catch (err) {
      alert("Failed to mark all as read: " + err.message);
    }
  }

  async function openSendNotificationModal() {
    const modal = document.getElementById("wmSendNotifModal");
    if (!modal) return;
    modal.hidden = false;

    // Reset status
    const status = document.getElementById("wmSendNotifStatus");
    if (status) status.style.display = "none";

    // Populate team members dropdown
    const select = document.getElementById("wmNotifRecipient");
    if (select) {
      select.innerHTML = '<option value="ALL">Entire Team (Everyone)</option>';
      activeGroupId = localStorage.getItem("wm_active_group");
      const api = getApi();
      if (activeGroupId && api && typeof api.listMembers === "function") {
        try {
          const res = await api.listMembers(activeGroupId);
          groupMembers = res.members || [];
          groupMembers.forEach((m) => {
            const opt = document.createElement("option");
            opt.value = m.userId;
            opt.textContent = `${m.name} (${m.email})`;
            select.appendChild(opt);
          });
        } catch (e) {
          console.warn("Could not load members for recipient list:", e);
        }
      }
    }
  }

  function closeSendNotificationModal() {
    const modal = document.getElementById("wmSendNotifModal");
    if (modal) modal.hidden = true;
  }

  async function handleSendNotificationSubmit() {
    activeGroupId = localStorage.getItem("wm_active_group");
    if (!activeGroupId) return alert("Please select a group first.");

    const recipientVal = document.getElementById("wmNotifRecipient").value;
    const titleVal = document.getElementById("wmNotifTitle").value.trim();
    const msgVal = document.getElementById("wmNotifMessage").value.trim();
    const submitBtn = document.getElementById("wmSendNotifSubmit");
    const status = document.getElementById("wmSendNotifStatus");

    if (!titleVal || !msgVal) return;

    const api = getApi();
    if (!api || typeof api.sendManualNotification !== "function") {
      console.error("[Notifications] Api.sendManualNotification is not available");
      status.style.display = "block";
      status.style.color = "var(--coral-500)";
      status.textContent = "Unable to send notification. Please try again.";
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";
    status.style.display = "none";

    try {
      const payload = {
        recipientType: recipientVal === "ALL" ? "ALL" : "MEMBER",
        recipientUserId: recipientVal === "ALL" ? null : recipientVal,
        title: titleVal,
        message: msgVal,
      };

      await api.sendManualNotification(activeGroupId, payload);

      status.style.display = "block";
      status.style.color = "var(--success-500)";
      status.textContent = "Notification sent successfully.";

      setTimeout(() => {
        closeSendNotificationModal();
        document.getElementById("wmSendNotifForm").reset();
      }, 1000);
    } catch (err) {
      console.error("[Notifications] Error sending notification:", err);
      status.style.display = "block";
      status.style.color = "var(--coral-500)";
      let displayMsg = "Unable to send notification. Please try again.";
      if (err && err.message && !err.message.includes("undefined") && !err.message.includes("not an object")) {
        displayMsg = err.message;
      }
      status.textContent = displayMsg;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send Notification";
    }
  }

  // Native push notifications setup with Capacitor
  async function setupPushNotifications() {
    if (typeof window === "undefined" || !window.Capacitor) return;

    const PushNotifications = window.Capacitor.Plugins?.PushNotifications;
    if (!PushNotifications) return;

    try {
      let permStatus = await PushNotifications.checkPermissions();
      if (permStatus.receive === "prompt" || permStatus.receive === "prompt-with-rationale") {
        permStatus = await PushNotifications.requestPermissions();
      }

      if (permStatus.receive !== "granted") {
        console.log("[Push] Permission not granted for push notifications:", permStatus.receive);
        return;
      }

      // Create Android Notification Channels (required for Android 8+)
      if (window.Capacitor.getPlatform() === "android") {
        try {
          await PushNotifications.createChannel({
            id: "water_turns",
            name: "Water Turn Alerts",
            description: "Alerts when it is your turn to bring drinking water",
            importance: 5,
            visibility: 1,
            vibration: true,
          });
          await PushNotifications.createChannel({
            id: "team_alerts",
            name: "Team Announcements",
            description: "Manual announcements and messages from teammates",
            importance: 5,
            visibility: 1,
            vibration: true,
          });
        } catch (channelErr) {
          console.warn("[Push] Android channel setup warning:", channelErr);
        }
      }

      // Add listeners before calling register()
      PushNotifications.addListener("registration", async (token) => {
        console.log("[Push] Registered with token:", token.value);
        if (window.Api && window.Api.registerDevice) {
          const platform = window.Capacitor.getPlatform() === "ios" ? "IOS" : "ANDROID";
          try {
            await window.Api.registerDevice(token.value, platform);
          } catch (e) {
            console.warn("[Push] Failed to save device token on server:", e);
          }
        }
      });

      PushNotifications.addListener("registrationError", (err) => {
        console.warn("[Push] Registration error:", err?.error || err);
      });

      PushNotifications.addListener("pushNotificationReceived", (notification) => {
        console.log("[Push] Notification received:", notification);
        loadUnreadCount();
      });

      PushNotifications.addListener("pushNotificationActionPerformed", (notification) => {
        console.log("[Push] Action performed:", notification);
        openNotificationCenter();
      });

      try {
        await PushNotifications.register();
      } catch (regErr) {
        console.warn("[Push] Push registration call failed:", regErr);
      }
    } catch (err) {
      console.warn("[Push] Init error:", err);
    }
  }

  function formatTimeAgo(isoString) {
    if (!isoString) return "";
    const date = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now - date) / 1000);

    if (diffSec < 60) return "Just now";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;

    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Expose global helper if needed
  window.NotificationManager = {
    openCenter: openNotificationCenter,
    openSendModal: openSendNotificationModal,
    refresh: loadUnreadCount,
  };
})();
