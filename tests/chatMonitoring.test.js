// T69 — chat quality monitoring: sender attribution on agent replies, session
// ownership (claim/accept), resolvedAt stamping, and the supervisor metrics
// endpoint. Also pins the two access rules the feature depends on: the public
// polling route stays cookie-gated and leaks no staff identity, and staff can't
// read the scoreboard they're measured on.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User");
const ChatSession = require("../models/ChatSession");

async function makeAgent(role = "admin", name = role) {
  const user = await User.create({
    name,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.com`,
    password: "Password123!",
    role,
    isVerified: true,
  });
  const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET);
  return { user, token };
}

let sessionCounter = 0;
function nextSessionId() {
  return `sess-${Date.now()}-${sessionCounter++}`;
}

async function makeSession(over = {}) {
  return ChatSession.create({
    sessionId: nextSessionId(),
    messages: [{ role: "user", content: "hello" }],
    ...over,
  });
}

describe("agent replies carry the sender (T69 phase 1)", () => {
  it("stamps senderId/senderName on the stored message and echoes them back", async () => {
    const { user, token } = await makeAgent("staff", "Ama Front-Desk");
    const session = await makeSession();

    const res = await request(app)
      .post(`/api/v1/chat/sessions/${session.sessionId}/reply`)
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "Hi, how can I help?" });

    expect(res.status).toBe(200);
    expect(res.body.data.senderName).toBe("Ama Front-Desk");

    const saved = await ChatSession.findOne({ sessionId: session.sessionId });
    const reply = saved.messages[saved.messages.length - 1];
    // role stays 'admin' — every existing renderer switches on it.
    expect(reply.role).toBe("admin");
    expect(reply.senderName).toBe("Ama Front-Desk");
    expect(String(reply.senderId)).toBe(user._id.toString());
  });

  it("never exposes the sender to the customer's widget", async () => {
    const { token } = await makeAgent("admin", "Kofi Admin");
    const session = await makeSession();
    await request(app)
      .post(`/api/v1/chat/sessions/${session.sessionId}/reply`)
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "On it." });

    const res = await request(app)
      .get(`/api/v1/chat/sessions/${session.sessionId}/messages`)
      .set("Cookie", [`ew_session=${session.sessionId}`]);

    expect(res.status).toBe(200);
    const adminMsg = res.body.data.find((m) => m.role === "admin");
    expect(adminMsg.content).toBe("On it.");
    expect(adminMsg.senderName).toBeUndefined();
    expect(adminMsg.senderId).toBeUndefined();
  });

  it("still refuses a caller whose ew_session cookie doesn't match the URL", async () => {
    const session = await makeSession();

    const res = await request(app)
      .get(`/api/v1/chat/sessions/${session.sessionId}/messages`)
      .set("Cookie", ["ew_session=someone-elses-session"]);

    expect(res.status).toBe(403);
  });
});

describe("session ownership and resolvedAt (T69 phase 2)", () => {
  it("accepting a pending request records who took it", async () => {
    const { user, token } = await makeAgent("staff", "Ama Front-Desk");
    const session = await makeSession({ humanRequested: true });

    const res = await request(app)
      .post(`/api/v1/chat/sessions/${session.sessionId}/accept`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.acceptedByName).toBe("Ama Front-Desk");
    expect(String(res.body.data.acceptedBy)).toBe(user._id.toString());
    expect(res.body.data.humanAcceptedAt).toBeTruthy();
  });

  it("claiming takes over an already-live chat without restarting the wait clock", async () => {
    const { token: staffToken } = await makeAgent("staff", "Ama Front-Desk");
    const { user: admin, token: adminToken } = await makeAgent("admin", "Kofi Admin");
    const session = await makeSession({ humanRequested: true });

    await request(app)
      .post(`/api/v1/chat/sessions/${session.sessionId}/accept`)
      .set("Authorization", `Bearer ${staffToken}`);
    const accepted = await ChatSession.findOne({ sessionId: session.sessionId });

    const res = await request(app)
      .post(`/api/v1/chat/sessions/${session.sessionId}/claim`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(String(res.body.data.acceptedBy)).toBe(admin._id.toString());
    expect(res.body.data.acceptedByName).toBe("Kofi Admin");
    expect(new Date(res.body.data.humanAcceptedAt).getTime())
      .toBe(accepted.humanAcceptedAt.getTime());
  });

  it("stamps resolvedAt on resolve and clears it on reopen", async () => {
    const { token } = await makeAgent("admin");
    const session = await makeSession();

    await request(app)
      .patch(`/api/v1/chat/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolved: true });
    let saved = await ChatSession.findOne({ sessionId: session.sessionId });
    expect(saved.resolvedAt).toBeTruthy();

    await request(app)
      .patch(`/api/v1/chat/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolved: false });
    saved = await ChatSession.findOne({ sessionId: session.sessionId });
    expect(saved.resolved).toBe(false);
    expect(saved.resolvedAt).toBeFalsy();
  });

  it("a reply to a resolved session reopens it and clears resolvedAt", async () => {
    const { token } = await makeAgent("admin");
    const session = await makeSession({ resolved: true, resolvedAt: new Date() });

    await request(app)
      .post(`/api/v1/chat/sessions/${session.sessionId}/reply`)
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "One more thing…" });

    const saved = await ChatSession.findOne({ sessionId: session.sessionId });
    expect(saved.resolved).toBe(false);
    expect(saved.resolvedAt).toBeFalsy();
  });
});

describe("customer rating (T69 phase 4)", () => {
  const rate = (sessionId, body, cookieSessionId = sessionId) =>
    request(app)
      .post(`/api/v1/chat/sessions/${sessionId}/rating`)
      .set("Cookie", [`ew_session=${cookieSessionId}`])
      .send(body);

  it("stores a star rating and comment on a closed conversation", async () => {
    const session = await makeSession({ resolved: true, resolvedAt: new Date() });

    const res = await rate(session.sessionId, { rating: 5, comment: "Fixed my screen same day!" });

    expect(res.status).toBe(200);
    const saved = await ChatSession.findOne({ sessionId: session.sessionId });
    expect(saved.rating).toBe(5);
    expect(saved.ratingComment).toBe("Fixed my screen same day!");
    expect(saved.ratedAt).toBeTruthy();
  });

  it("refuses a caller whose cookie doesn't match the session", async () => {
    const session = await makeSession({ resolved: true });
    const res = await rate(session.sessionId, { rating: 5 }, "someone-elses-session");
    expect(res.status).toBe(403);
  });

  it("refuses a rating on a conversation that's still open", async () => {
    const session = await makeSession({ resolved: false });
    const res = await rate(session.sessionId, { rating: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/still open/);
  });

  it.each([0, 6, 2.5, "great", null])("rejects %p as a star value", async (rating) => {
    const session = await makeSession({ resolved: true });
    const res = await rate(session.sessionId, { rating });
    expect(res.status).toBe(400);
  });

  it("lets the same visitor correct a misclicked star", async () => {
    const session = await makeSession({ resolved: true });
    await rate(session.sessionId, { rating: 1 });
    await rate(session.sessionId, { rating: 4 });

    const saved = await ChatSession.findOne({ sessionId: session.sessionId });
    expect(saved.rating).toBe(4);
  });

  it("tells the widget the current rating so it stops asking", async () => {
    const session = await makeSession({ resolved: true });
    await rate(session.sessionId, { rating: 3 });

    const res = await request(app)
      .get(`/api/v1/chat/sessions/${session.sessionId}/messages`)
      .set("Cookie", [`ew_session=${session.sessionId}`]);

    expect(res.body.meta.rating).toBe(3);
  });
});

describe("GET /api/v1/chat/metrics (T69 phase 3)", () => {
  it("is closed to staff — they're the ones being measured", async () => {
    const { token } = await makeAgent("staff");
    const res = await request(app)
      .get("/api/v1/chat/metrics")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("is closed to anonymous callers", async () => {
    const res = await request(app).get("/api/v1/chat/metrics");
    expect(res.status).toBe(401);
  });

  it("reports volume, median first-response time, resolution and a per-staff split", async () => {
    const { user: ama }  = await makeAgent("staff", "Ama Front-Desk");
    const { user: kofi } = await makeAgent("staff", "Kofi Front-Desk");
    const { token: adminToken } = await makeAgent("admin", "Supervisor");

    const accepted = new Date("2026-08-20T10:00:00Z");
    // Ama answers after 60s, Kofi after 180s → median of [60000, 180000] = 120000.
    await makeSession({
      humanRequested: true, humanAccepted: true, humanAcceptedAt: accepted,
      acceptedBy: ama._id, acceptedByName: "Ama Front-Desk",
      resolved: true,
      createdAt: accepted, resolvedAt: new Date(accepted.getTime() + 10 * 60 * 1000),
      messages: [
        { role: "user", content: "hi", createdAt: accepted },
        { role: "admin", content: "hello", createdAt: new Date(accepted.getTime() + 60 * 1000), senderId: ama._id, senderName: "Ama Front-Desk" },
      ],
    });
    await makeSession({
      humanRequested: true, humanAccepted: true, humanAcceptedAt: accepted,
      acceptedBy: kofi._id, acceptedByName: "Kofi Front-Desk",
      createdAt: accepted,
      messages: [
        { role: "user", content: "hi", createdAt: accepted },
        { role: "admin", content: "hello", createdAt: new Date(accepted.getTime() + 180 * 1000), senderId: kofi._id, senderName: "Kofi Front-Desk" },
        { role: "admin", content: "anything else?", createdAt: new Date(accepted.getTime() + 240 * 1000), senderId: kofi._id, senderName: "Kofi Front-Desk" },
      ],
    });
    // Bot-only session in range — counts toward volume, not toward response times.
    await makeSession({ createdAt: accepted });

    const res = await request(app)
      .get("/api/v1/chat/metrics?from=2026-08-01&to=2026-08-31")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const { totals, firstResponse, resolution, perStaff } = res.body.data;

    expect(totals.sessions).toBe(3);
    expect(totals.humanRequested).toBe(2);
    expect(totals.accepted).toBe(2);
    expect(totals.resolved).toBe(1);
    expect(totals.resolutionRate).toBeCloseTo(33.3, 1);

    expect(firstResponse.sampleSize).toBe(2);
    expect(firstResponse.medianMs).toBe(120000);
    expect(resolution.sampleSize).toBe(1);
    expect(resolution.medianMs).toBe(10 * 60 * 1000);

    const amaRow  = perStaff.find((r) => r.staffId === ama._id.toString());
    const kofiRow = perStaff.find((r) => r.staffId === kofi._id.toString());
    expect(amaRow).toMatchObject({ name: "Ama Front-Desk", claimed: 1, replies: 1, resolved: 1, medianFirstResponseMs: 60000 });
    expect(kofiRow).toMatchObject({ name: "Kofi Front-Desk", claimed: 1, replies: 2, resolved: 0, medianFirstResponseMs: 180000 });
    // Busiest agent first.
    expect(perStaff[0].staffId).toBe(kofi._id.toString());
  });

  it("averages CSAT overall and per agent, and reports how many closed chats replied", async () => {
    const { user: ama }  = await makeAgent("staff", "Ama Front-Desk");
    const { user: kofi } = await makeAgent("staff", "Kofi Front-Desk");
    const { token }      = await makeAgent("admin", "Supervisor");

    const closed = { resolved: true, resolvedAt: new Date() };
    // Ama: 5 and 4 → 4.5. Kofi: 2 → 2. One closed chat left unrated.
    await makeSession({ ...closed, acceptedBy: ama._id,  acceptedByName: "Ama Front-Desk",  rating: 5 });
    await makeSession({ ...closed, acceptedBy: ama._id,  acceptedByName: "Ama Front-Desk",  rating: 4 });
    await makeSession({ ...closed, acceptedBy: kofi._id, acceptedByName: "Kofi Front-Desk", rating: 2 });
    await makeSession({ ...closed, acceptedBy: kofi._id, acceptedByName: "Kofi Front-Desk" });

    const res = await request(app)
      .get("/api/v1/chat/metrics")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const { csat, perStaff } = res.body.data;

    expect(csat.count).toBe(3);
    expect(csat.average).toBeCloseTo(3.7, 1);   // (5+4+2)/3 = 3.67
    expect(csat.responseRate).toBeCloseTo(75, 1); // 3 of 4 closed chats rated

    expect(perStaff.find((r) => r.staffId === ama._id.toString()))
      .toMatchObject({ csatAverage: 4.5, csatCount: 2 });
    expect(perStaff.find((r) => r.staffId === kofi._id.toString()))
      .toMatchObject({ csatAverage: 2, csatCount: 1 });
  });

  it("reports a null CSAT average rather than 0 when nobody has rated", async () => {
    const { token } = await makeAgent("admin");
    await makeSession({ resolved: true, resolvedAt: new Date() });

    const res = await request(app)
      .get("/api/v1/chat/metrics")
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.data.csat).toMatchObject({ average: null, count: 0, responseRate: 0 });
  });

  it("buckets pre-T69 replies that carry no sender", async () => {
    const { token } = await makeAgent("admin");
    await makeSession({
      messages: [
        { role: "user", content: "hi" },
        { role: "admin", content: "legacy reply, no sender" },
      ],
    });

    const res = await request(app)
      .get("/api/v1/chat/metrics")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const unattributed = res.body.data.perStaff.find((r) => r.staffId === null);
    expect(unattributed.replies).toBe(1);
    expect(unattributed.name).toMatch(/Unattributed/);
  });

  it("excludes sessions outside the requested window", async () => {
    const { token } = await makeAgent("admin");
    await makeSession({ createdAt: new Date("2026-01-15T10:00:00Z") });
    await makeSession({ createdAt: new Date("2026-08-20T10:00:00Z") });

    const res = await request(app)
      .get("/api/v1/chat/metrics?from=2026-08-01&to=2026-08-31")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totals.sessions).toBe(1);
  });

  it("falls back to the default window when the dates are junk", async () => {
    const { token } = await makeAgent("admin");
    await makeSession();

    const res = await request(app)
      .get("/api/v1/chat/metrics?from=not-a-date&to=also-junk")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totals.sessions).toBe(1);
    const { from, to } = res.body.data.range;
    expect(Math.round((new Date(to) - new Date(from)) / (24 * 60 * 60 * 1000))).toBe(30);
  });
});
