/**
 * WaterMate 2.0 Team Chat
 * Incremental cursor/since polling, media preview & upload, 7-day retention display.
 */

(async function () {
  const currentUser = await requireLoggedIn();
  if (!currentUser) return;

  const groupId = getActiveGroupId();
  if (!groupId) {
    window.location.href = "group.html";
    return;
  }

  // DOM Elements
  const chatMessagesEl = document.getElementById("chatMessages");
  const chatFormEl = document.getElementById("chatForm");
  const chatTextInput = document.getElementById("chatTextInput");
  const chatFileInput = document.getElementById("chatFileInput");
  const chatAttachBtn = document.getElementById("chatAttachBtn");
  const chatSendBtn = document.getElementById("chatSendBtn");
  const chatFilePreview = document.getElementById("chatFilePreview");
  const chatFileName = document.getElementById("chatFileName");
  const chatFileSize = document.getElementById("chatFileSize");
  const chatFileRemove = document.getElementById("chatFileRemove");
  const chatGroupName = document.getElementById("chatGroupName");
  const chatMembersCount = document.getElementById("chatMembersCount");
  const chatSendAlertBtn = document.getElementById("chatSendAlertBtn");
  const pageAlert = document.getElementById("pageAlert");

  // State
  let selectedFile = null;
  let messages = [];
  let pollTimer = null;
  let isSending = false;
  let userAtBottom = true;

  // Render user profile in topbar
  renderUserBox(currentUser);

  // Load group details
  loadGroupInfo();

  // Load initial messages
  await fetchMessages(true);

  // Setup auto-refresh polling (every 3.5 seconds)
  startPolling();

  // Listen for window visibility change to conserve bandwidth
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      fetchMessages(false);
      startPolling();
    } else {
      stopPolling();
    }
  });

  // Track scroll position
  chatMessagesEl.addEventListener("scroll", () => {
    const threshold = 60;
    const distanceToBottom =
      chatMessagesEl.scrollHeight - chatMessagesEl.scrollTop - chatMessagesEl.clientHeight;
    userAtBottom = distanceToBottom < threshold;
  });

  // Attach button triggers file input
  chatAttachBtn.addEventListener("click", () => {
    chatFileInput.click();
  });

  // File selection
  chatFileInput.addEventListener("change", () => {
    const file = chatFileInput.files[0];
    if (!file) return;

    // Check size limit: 15MB
    const maxBytes = 15 * 1024 * 1024;
    if (file.size > maxBytes) {
      showAlert("Selected file exceeds the 15MB size limit. Please choose a smaller file.", "error");
      chatFileInput.value = "";
      return;
    }

    selectedFile = file;
    chatFileName.textContent = file.name;
    chatFileSize.textContent = formatBytes(file.size);
    chatFilePreview.style.display = "flex";
    updateSendButtonState();
  });

  // Remove attachment
  chatFileRemove.addEventListener("click", () => {
    clearAttachment();
  });

  // Text input typing
  chatTextInput.addEventListener("input", () => {
    updateSendButtonState();
  });

  // Form submit
  chatFormEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (isSending) return;

    const content = chatTextInput.value.trim();
    const fileToUpload = selectedFile;

    if (!content && !fileToUpload) return;

    isSending = true;
    chatSendBtn.disabled = true;
    chatSendBtn.innerHTML = `<span class="spinner" style="width:16px; height:16px; border-width:2px;"></span>`;

    try {
      await Api.sendChatMessage(groupId, content, fileToUpload);

      // Reset form
      chatTextInput.value = "";
      clearAttachment();
      showAlert("", ""); // Clear alerts

      // Fetch immediately
      await fetchMessages(false);
      scrollToBottom();
    } catch (err) {
      showAlert(err.message || "Failed to send message.", "error");
    } finally {
      isSending = false;
      chatSendBtn.disabled = false;
      chatSendBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      `;
      updateSendButtonState();
    }
  });

  // Alert Team shortcut
  if (chatSendAlertBtn) {
    chatSendAlertBtn.addEventListener("click", () => {
      if (window.NotificationManager && window.NotificationManager.openSendModal) {
        window.NotificationManager.openSendModal();
      }
    });
  }

  // --- Helpers ---

  function clearAttachment() {
    selectedFile = null;
    chatFileInput.value = "";
    chatFilePreview.style.display = "none";
    updateSendButtonState();
  }

  function updateSendButtonState() {
    const hasText = Boolean(chatTextInput.value.trim());
    const hasFile = Boolean(selectedFile);
    chatSendBtn.disabled = !hasText && !hasFile;
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      fetchMessages(false);
    }, 3500);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function loadGroupInfo() {
    try {
      const data = await Api.getDashboard(groupId);
      if (data.group) {
        chatGroupName.textContent = data.group.name;
        chatMembersCount.textContent = `${data.members.length} teammate${data.members.length === 1 ? "" : "s"}`;
      }
    } catch (e) {
      console.warn("Could not load group info:", e);
    }
  }

  async function fetchMessages(isInitial = false) {
    try {
      const data = await Api.getChatMessages(groupId, { limit: 50 });
      const newMessages = data.messages || [];

      // Check if messages changed
      const currentIds = messages.map((m) => m.id).join(",");
      const newIds = newMessages.map((m) => m.id).join(",");

      if (currentIds !== newIds || isInitial) {
        messages = newMessages;
        renderMessages();
        if (isInitial || userAtBottom) {
          scrollToBottom();
        }
      }
    } catch (err) {
      if (isInitial) {
        chatMessagesEl.innerHTML = `
          <div class="chat-empty">
            <div class="chat-empty__icon">⚠️</div>
            <p>Could not load chat messages.</p>
            <span style="font-size:0.75rem; color:var(--coral-500);">${escapeHtml(err.message)}</span>
          </div>
        `;
      }
    }
  }

  function renderMessages() {
    if (messages.length === 0) {
      chatMessagesEl.innerHTML = `
        <div class="chat-empty">
          <div class="chat-empty__icon">💬</div>
          <p>No messages yet.</p>
          <span style="font-size:0.8rem; opacity:0.7;">Start the conversation with your team!</span>
        </div>
      `;
      return;
    }

    let html = "";
    let lastDateStr = "";

    messages.forEach((msg) => {
      const msgDate = new Date(msg.createdAt);
      const dateStr = msgDate.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });

      // Date divider
      if (dateStr !== lastDateStr) {
        lastDateStr = dateStr;
        html += `
          <div class="chat-date-divider">
            <span>${dateStr}</span>
          </div>
        `;
      }

      const isMine = msg.senderId === currentUser.id;
      const senderName = msg.sender?.name || "Teammate";
      const timeStr = msgDate.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      // Expiry calculation
      const daysLeft = msg.expiresAt
        ? Math.max(1, Math.ceil((new Date(msg.expiresAt) - new Date()) / (1000 * 60 * 60 * 24)))
        : 7;

      html += `
        <div class="chat-msg-row ${isMine ? "is-mine" : "is-theirs"}">
          ${
            !isMine
              ? `<div class="chat-msg-avatar" title="${escapeHtml(senderName)}">${initials(senderName)}</div>`
              : ""
          }
          <div class="chat-msg-bubble">
            ${!isMine ? `<div class="chat-msg-sender">${escapeHtml(senderName)}</div>` : ""}
            ${msg.content ? `<div class="chat-msg-text">${escapeHtml(msg.content)}</div>` : ""}
            ${renderAttachmentsHtml(msg.attachments)}
            <div class="chat-msg-meta">
              <span>${timeStr}</span>
              <span class="chat-msg-expiry" title="Expires in ${daysLeft} days">• ${daysLeft}d</span>
            </div>
          </div>
        </div>
      `;
    });

    chatMessagesEl.innerHTML = html;
  }

  function renderAttachmentsHtml(attachments) {
    if (!attachments || attachments.length === 0) return "";

    return attachments
      .map((att) => {
        const fileUrl = `${API_BASE}/groups/${groupId}/chat/attachments/${att.id}`;
        const isImage = att.fileType && att.fileType.startsWith("image/");
        const isVideo = att.fileType && att.fileType.startsWith("video/");

        if (isImage) {
          return `
            <div class="chat-attachment-box">
              <a href="${fileUrl}" target="_blank" rel="noopener noreferrer">
                <img class="chat-attachment-img" src="${fileUrl}" alt="${escapeHtml(att.fileName)}" loading="lazy" />
              </a>
            </div>
          `;
        }

        if (isVideo) {
          return `
            <div class="chat-attachment-box">
              <video class="chat-attachment-video" controls preload="metadata">
                <source src="${fileUrl}" type="${att.fileType}" />
                Your browser does not support video.
              </video>
            </div>
          `;
        }

        // Generic document / file
        return `
          <div class="chat-attachment-box">
            <a href="${fileUrl}" target="_blank" download="${escapeHtml(att.fileName)}" class="chat-attachment-doc">
              <span class="chat-doc-icon">📄</span>
              <div class="chat-doc-info">
                <span class="chat-doc-name">${escapeHtml(att.fileName)}</span>
                <span class="chat-doc-size">${formatBytes(att.fileSize)}</span>
              </div>
            </a>
          </div>
        `;
      })
      .join("");
  }

  function scrollToBottom() {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  function renderUserBox(user) {
    const userBox = document.getElementById("userBox");
    if (!userBox) return;

    userBox.innerHTML = `
      <div class="avatar" title="${escapeHtml(user.email)}">${initials(user.name)}</div>
      <button class="btn-link" id="logoutBtn" type="button">Log out</button>
    `;

    document.getElementById("logoutBtn").addEventListener("click", async () => {
      await Api.logout();
      window.location.href = "login.html";
    });
  }

  function showAlert(message, type) {
    if (!pageAlert) return;
    if (!message) {
      pageAlert.innerHTML = "";
      return;
    }
    pageAlert.innerHTML = `
      <div class="alert alert-${type === "error" ? "danger" : "info"}" style="margin-bottom:12px;">
        ${escapeHtml(message)}
      </div>
    `;
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
})();
