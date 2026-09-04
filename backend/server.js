require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const authRoutes = require("./routes/authRoutes");
const groupRoutes = require("./routes/groupRoutes");
const memberRoutes = require("./routes/memberRoutes");
const waterRoutes = require("./routes/waterRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// Uploaded water photos
const UPLOADS_DIR = process.env.VERCEL
  ? path.join("/tmp", "uploads")
  : path.join(__dirname, "uploads");
app.use("/uploads", express.static(UPLOADS_DIR));

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/groups/:groupId/members", memberRoutes);
app.use("/api/groups/:groupId", waterRoutes);

// Serve the vanilla HTML/CSS/JS frontend
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
app.use(express.static(FRONTEND_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

// 404 for unmatched API routes
app.use("/api", (req, res) => {
  res.status(404).json({ message: "Not found." });
});

// Central error handler - never leak raw database/internal error details
app.use((err, req, res, next) => {
  console.error(err);

  if (err?.code === "P2002") {
    return res.status(409).json({ message: "That value is already in use." });
  }

  res.status(err.status || 500).json({
    message: "Unable to complete your request. Please try again.",
  });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`WaterMate server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
