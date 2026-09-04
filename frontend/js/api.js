// Central place for every network call the frontend makes. No other file
// should call fetch() directly - this keeps API logic from being
// duplicated across pages.

const API_BASE = "/api";

async function apiRequest(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "include",
    ...options,
  });

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
  const response = await fetch(`${API_BASE}${url}`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

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
  // Auth
  register: (payload) =>
    apiRequest("/auth/register", { method: "POST", body: JSON.stringify(payload) }),
  login: (payload) =>
    apiRequest("/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  logout: () => apiRequest("/auth/logout", { method: "POST" }),
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
