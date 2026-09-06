// Central place for every network call the frontend makes. No other file
// should call fetch() directly - this keeps API logic from being
// duplicated across pages.

const PRODUCTION_API_URL = "https://watermate.vercel.app/api";

function isNativePlatform() {
  return (
    typeof window !== "undefined" &&
    (window.Capacitor !== undefined ||
      window.location.protocol === "capacitor:" ||
      window.location.protocol === "ionic:" ||
      window.location.protocol === "file:" ||
      (window.location.hostname === "localhost" && !window.location.port))
  );
}

// Single configurable API base URL
// Web uses relative '/api' on same origin, mobile app uses production API URL
const API_BASE =
  (typeof window !== "undefined" && window.WATERMATE_API_BASE) ||
  (isNativePlatform() ? PRODUCTION_API_URL : "/api");

function resolveMediaUrl(path) {
  if (!path) return "";
  if (
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("data:") ||
    path.startsWith("blob:")
  ) {
    return path;
  }
  const origin = API_BASE.replace(/\/api\/?$/, "");
  return `${origin}${path.startsWith("/") ? "" : "/"}${path}`;
}

function checkOnline() {
  if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) {
    throw new Error("No internet connection. Please check your connection and try again.");
  }
}

async function apiRequest(url, options = {}) {
  checkOnline();

  const token = typeof localStorage !== "undefined" ? localStorage.getItem("wm_auth_token") : null;
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  let response;
  try {
    response = await fetch(`${API_BASE}${url}`, {
      credentials: "include",
      ...options,
      headers,
    });
  } catch (err) {
    if (
      (typeof navigator !== "undefined" && !navigator.onLine) ||
      err.name === "TypeError" ||
      err.message?.toLowerCase().includes("fetch")
    ) {
      throw new Error("No internet connection. Please check your connection and try again.");
    }
    throw err;
  }

  let data = {};
  try {
    data = await response.json();
  } catch (_) {
    // Some responses (e.g. 204) have no body.
  }

  if (!response.ok) {
    throw new Error(data.message || "Something went wrong.");
  }

  return data;
}

async function apiUpload(url, formData) {
  checkOnline();

  const token = typeof localStorage !== "undefined" ? localStorage.getItem("wm_auth_token") : null;
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  let response;
  try {
    response = await fetch(`${API_BASE}${url}`, {
      method: "POST",
      credentials: "include",
      headers,
      body: formData,
    });
  } catch (err) {
    if (
      (typeof navigator !== "undefined" && !navigator.onLine) ||
      err.name === "TypeError" ||
      err.message?.toLowerCase().includes("fetch")
    ) {
      throw new Error("No internet connection. Please check your connection and try again.");
    }
    throw err;
  }

  let data = {};
  try {
    data = await response.json();
  } catch (_) {
    /* no body */
  }

  if (!response.ok) {
    throw new Error(data.message || "Something went wrong.");
  }

  return data;
}

const Api = {
  resolveMediaUrl,
  // Auth
  register: async (payload) => {
    const data = await apiRequest("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (data.token && typeof localStorage !== "undefined") {
      localStorage.setItem("wm_auth_token", data.token);
    }
    return data;
  },
  login: async (payload) => {
    const data = await apiRequest("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (data.token && typeof localStorage !== "undefined") {
      localStorage.setItem("wm_auth_token", data.token);
    }
    return data;
  },
  logout: async () => {
    try {
      await apiRequest("/auth/logout", { method: "POST" });
    } finally {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem("wm_auth_token");
        localStorage.removeItem("wm_active_group");
      }
    }
  },
  me: () => apiRequest("/auth/me"),

  // Groups
  createGroup: (name) =>
    apiRequest("/groups", { method: "POST", body: JSON.stringify({ name }) }),
  listGroups: () => apiRequest("/groups"),
  getGroup: (groupId) => apiRequest(`/groups/${groupId}`),
  joinGroup: (inviteCode) =>
    apiRequest("/groups/join", { method: "POST", body: JSON.stringify({ inviteCode }) }),
  renameGroup: (groupId, name) =>
    apiRequest(`/groups/${groupId}`, { method: "PUT", body: JSON.stringify({ name }) }),
  leaveGroup: (groupId) =>
    apiRequest(`/groups/${groupId}/leave`, { method: "POST" }),
  transferAdmin: (groupId, newAdminUserId) =>
    apiRequest(`/groups/${groupId}/transfer-admin`, {
      method: "POST",
      body: JSON.stringify({ newAdminUserId }),
    }),
  deleteGroup: (groupId) =>
    apiRequest(`/groups/${groupId}`, { method: "DELETE" }),

  // Members
  listMembers: (groupId) => apiRequest(`/groups/${groupId}/members`),
  updateTurnOrder: (groupId, order) =>
    apiRequest(`/groups/${groupId}/members/order`, {
      method: "PUT",
      body: JSON.stringify({ order }),
    }),
  removeMember: (groupId, memberId) =>
    apiRequest(`/groups/${groupId}/members/${memberId}`, { method: "DELETE" }),

  // Water
  submitWater: (groupId, file) => {
    const formData = new FormData();
    formData.append("photo", file);
    return apiUpload(`/groups/${groupId}/water`, formData);
  },
  getHistory: (groupId, page = 1) =>
    apiRequest(`/groups/${groupId}/water?page=${page}`),
  getLatest: (groupId) => apiRequest(`/groups/${groupId}/water/latest`),
  getDashboard: (groupId) => apiRequest(`/groups/${groupId}/dashboard`),

  // Chat (WaterMate 2.0)
  getChatMessages: (groupId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/groups/${groupId}/chat${query ? `?${query}` : ""}`);
  },
  sendChatMessage: (groupId, content, file) => {
    if (file) {
      const formData = new FormData();
      if (content) formData.append("content", content);
      formData.append("file", file);
      return apiUpload(`/groups/${groupId}/chat`, formData);
    }
    return apiRequest(`/groups/${groupId}/chat`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
  },

  // Notifications (WaterMate 2.0)
  listNotifications: (groupId, page = 1) =>
    apiRequest(`/groups/${groupId}/notifications?page=${page}`),
  sendManualNotification: (groupId, payload) =>
    apiRequest(`/groups/${groupId}/notifications`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  markNotificationRead: (groupId, notifId) =>
    apiRequest(`/groups/${groupId}/notifications/${notifId}/read`, {
      method: "POST",
    }),
  markAllNotificationsRead: (groupId) =>
    apiRequest(`/groups/${groupId}/notifications/read-all`, {
      method: "POST",
    }),

  // Device push tokens
  registerDevice: (token, platform) =>
    apiRequest("/notifications/devices", {
      method: "POST",
      body: JSON.stringify({ token, platform }),
    }),
  unregisterDevice: (token) =>
    apiRequest("/notifications/devices", {
      method: "DELETE",
      body: JSON.stringify({ token }),
    }),
};

// --- Small shared helpers used across pages ---

function getActiveGroupId() {
  return localStorage.getItem("wm_active_group");
}

function setActiveGroupId(groupId) {
  localStorage.setItem("wm_active_group", groupId);
}

function formatDateTime(isoString) {
  const d = new Date(isoString);
  const datePart = d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timePart = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${datePart} \u2022 ${timePart}`;
}

function initials(name) {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

/**
 * Redirects to login if the user isn't authenticated. Call at the top of
 * every protected page. Returns the current user on success.
 */
async function requireLoggedIn() {
  try {
    const { user } = await Api.me();
    return user;
  } catch (err) {
    window.location.href = "login.html";
    return null;
  }
}
