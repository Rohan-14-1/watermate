require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const authRoutes = require("./routes/authRoutes");
const groupRoutes = require("./routes/groupRoutes");
const memberRoutes = require("./routes/memberRoutes");
const waterRoutes = require("./routes/waterRoutes");
const chatRoutes = require("./routes/chatRoutes");
const groupNotificationRoutes = require("./routes/groupNotificationRoutes");
const deviceRoutes = require("./routes/deviceRoutes");
const cronRoutes = require("./routes/cronRoutes");

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
app.use("/api/groups/:groupId/chat", chatRoutes);
app.use("/api/groups/:groupId/notifications", groupNotificationRoutes);
app.use("/api/groups/:groupId", waterRoutes);
app.use("/api/notifications", deviceRoutes);
app.use("/api/cron", cronRoutes);

// Serve the vanilla HTML/CSS/JS frontend
const FRONTEND_DIR = fs.existsSync(path.join(__dirname, "..", "public"))
  ? path.join(__dirname, "..", "public")
  : path.join(__dirname, "..", "frontend");
app.use(express.static(FRONTEND_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

// Health check & diagnostic endpoint
app.get("/api/health", async (req, res) => {
  const dbUrl = process.env.DATABASE_URL;
  const isLocalhost = !dbUrl || dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1");

  const response = {
    status: "ok",
    environment: process.env.NODE_ENV || "development",
    isVercel: Boolean(process.env.VERCEL),
    database: {
      configured: Boolean(dbUrl),
      isLocalhost,
      connected: false,
    },
    jwtSecretConfigured: Boolean(process.env.JWT_SECRET),
    storage: {
      configured: Boolean(
        process.env.SUPABASE_URL &&
          (process.env.SUPABASE_SERVICE_ROLE_KEY ||
            process.env.SUPABASE_ANON_KEY ||
            process.env.SUPABASE_KEY)
      ),
      hasUrl: Boolean(process.env.SUPABASE_URL),
      hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      bucket: (process.env.SUPABASE_WATER_BUCKET || "water-deliveries").trim(),
    },
  };

  if (!dbUrl) {
    response.status = "error";
    response.database.message = "DATABASE_URL environment variable is missing in Vercel settings.";
    return res.status(503).json(response);
  }

  if (process.env.VERCEL && isLocalhost) {
    response.status = "error";
    response.database.message =
      "DATABASE_URL is set to localhost. Vercel serverless functions cannot connect to localhost. Please connect a hosted PostgreSQL database (such as Neon, Supabase, or Railway) in Vercel Project Settings > Environment Variables.";
    return res.status(503).json(response);
  }

  try {
    const prisma = require("./prisma/client");
    await prisma.$queryRaw`SELECT 1`;
    response.database.connected = true;
    return res.json(response);
  } catch (err) {
    response.status = "error";
    response.database.connected = false;
    response.database.message = err.message;
    response.database.code = err.code || null;
    return res.status(500).json(response);
  }
});

// 404 for unmatched API routes
app.use("/api", (req, res) => {
  res.status(404).json({ message: "Not found." });
});

// Central error handler
app.use((err, req, res, next) => {
  console.error("Server error:", err);

  if (err?.code === "P2002") {
    return res.status(409).json({ message: "That value is already in use." });
  }

  const dbUrl = process.env.DATABASE_URL;
  const isPrismaError =
    err?.name === "PrismaClientInitializationError" ||
    err?.name === "PrismaClientKnownRequestError" ||
    err?.name === "PrismaClientRustPanicError" ||
    err?.code?.startsWith("P1") ||
    err?.code?.startsWith("P2");

  if (isPrismaError) {
    if (!dbUrl) {
      return res.status(503).json({
        message: "Database not configured: DATABASE_URL is missing in Vercel Environment Variables.",
      });
    }

    if (process.env.VERCEL && (dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1"))) {
      return res.status(503).json({
        message: "Database error: DATABASE_URL is set to localhost. Vercel cannot reach your local computer. Please connect a hosted PostgreSQL database (e.g. Neon or Supabase).",
      });
    }

    if (err?.code === "P1001" || err?.code === "P1000") {
      return res.status(503).json({
        message: "Database connection failed. Please verify your cloud database credentials and that it is active.",
      });
    }

    if (err?.code === "P2021") {
      return res.status(503).json({
        message: "Database tables are missing. Migrations will be applied automatically on your next Vercel deployment.",
      });
    }
  }

  res.status(err.status || 500).json({
    message: err.message || "Unable to complete your request. Please try again.",
    code: err.code || null,
  });
});

if (require.main === module && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`WaterMate server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
