const assert = require("assert");
const app = require("../server");
const http = require("http");

async function testFullSystem() {
  console.log("=========================================");
  console.log("🔍 Testing System Health & Feature Parity");
  console.log("=========================================\n");

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Health check
    let res = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(res.status, 200, "Health check should return 200");
    const health = await res.json();
    assert.strictEqual(health.status, "ok");
    assert.strictEqual(health.database.connected, true);
    console.log("✔ 1. Server & Database health OK.");

    // 2. Auth login (Rohan)
    res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "rohan@example.com", password: "password123" })
    });
    assert.strictEqual(res.status, 200, "Rohan login should succeed");
    const authData = await res.json();
    assert(authData.token, "Token should be returned");
    const token = authData.token;
    const authHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    };
    console.log("✔ 2. Existing Authentication (Login) intact.");

    // 3. Groups listing
    res = await fetch(`${baseUrl}/api/groups`, { headers: authHeaders });
    assert.strictEqual(res.status, 200);
    const groupsData = await res.json();
    const group = groupsData.groups.find(g => g.name === "Sunrise Apartment");
    assert(group, "Sunrise Apartment group must exist");
    console.log("✔ 3. Existing Groups service intact.");

    // 4. Dashboard data
    res = await fetch(`${baseUrl}/api/groups/${group.id}/dashboard`, { headers: authHeaders });
    assert.strictEqual(res.status, 200);
    const dashData = await res.json();
    assert(dashData.group, "Dashboard should contain group info");
    assert(dashData.members, "Dashboard should contain members");
    console.log("✔ 4. Existing Dashboard intact.");

    // 5. Chicken turn
    res = await fetch(`${baseUrl}/api/groups/${group.id}/chicken`, { headers: authHeaders });
    assert.strictEqual(res.status, 200);
    const chickenData = await res.json();
    assert(chickenData.status, "Chicken turn system should respond with status");
    console.log("✔ 5. Existing Chicken Turn system intact.");

    // 6. Chat messages
    res = await fetch(`${baseUrl}/api/groups/${group.id}/chat`, { headers: authHeaders });
    assert.strictEqual(res.status, 200);
    console.log("✔ 6. Existing Chat system intact.");

    // 7. UNO API endpoints via HTTP
    res = await fetch(`${baseUrl}/api/uno/config`);
    assert.strictEqual(res.status, 200);
    const unoConfig = await res.json();
    assert(unoConfig !== undefined);

    res = await fetch(`${baseUrl}/api/uno/groups/${group.id}/games`, { headers: authHeaders });
    assert.strictEqual(res.status, 200);
    const groupGames = await res.json();
    assert(Array.isArray(groupGames.games));
    console.log("✔ 7. New UNO HTTP endpoints responding properly.");

    // 8. Static frontend file delivery (public directory)
    const staticCheck = await fetch(`${baseUrl}/games.html`);
    assert.strictEqual(staticCheck.status, 200);
    const htmlText = await staticCheck.text();
    assert(htmlText.includes("Multiplayer UNO"), "games.html should be served statically");

    const unoCheck = await fetch(`${baseUrl}/uno.html`);
    assert.strictEqual(unoCheck.status, 200);
    const unoHtml = await unoCheck.text();
    assert(unoHtml.includes("UNO Arena"), "uno.html should be served statically");
    console.log("✔ 8. Static frontend pages (games.html, uno.html) served correctly.");

    console.log("\n=========================================");
    console.log("🎉 ALL SYSTEM HEALTH & PARITY TESTS PASSED!");
    console.log("=========================================\n");
  } finally {
    server.close();
  }
}

testFullSystem().catch(e => {
  console.error("System health test failed:", e);
  process.exit(1);
});
