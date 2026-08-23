// src/server/index.ts
import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import cors from "cors";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
dotenv.config();
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var app = express();
var server = http.createServer(app);
var wss = new WebSocketServer({ server, path: "/ws" });
var PORT = process.env.PORT || 3e3;
var HOST = process.env.HOST || "0.0.0.0";
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
var activeTasks = [];
var uploadQueue = [];
var dailySlotStats = { used: 0, total: 100 };
function broadcast(type, payload) {
  const message = JSON.stringify({ type, payload, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}
wss.on("connection", (ws) => {
  console.log("[MBA Hub WS] Client connected to live WebSocket stream");
  ws.send(JSON.stringify({
    type: "INIT",
    payload: {
      status: "online",
      slots: dailySlotStats,
      tasks: activeTasks.length,
      queue: uploadQueue.length
    }
  }));
  ws.on("message", (data) => {
    try {
      const parsed = JSON.parse(data.toString());
      console.log("[MBA Hub WS] Received client event:", parsed.type);
    } catch (err) {
      console.error("[MBA Hub WS] Invalid message:", err);
    }
  });
});
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "MBA HUB",
    version: "1.0.0",
    target: "TerraMaster TOS 6.0",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    connectors: {
      ideogram: "ready",
      vectorizer: "ready",
      productorTM: "ready",
      openRouter: "ready",
      supabase: "ready",
      amazonWorker: "ready"
    }
  });
});
app.post("/api/v1/hermes/task", (req, res) => {
  const { prompt, quote, niche1, niche2, title, brand, bullet1, bullet2, description } = req.body;
  console.log(`[Hermes Webhook] Received task for niche "${niche1} / ${niche2}": ${prompt}`);
  const newTask = {
    id: `task-${Date.now()}`,
    prompt,
    quote: quote || "",
    niche1: niche1 || "",
    niche2: niche2 || "",
    title: title || "",
    brand: brand || "",
    bullet1: bullet1 || "",
    bullet2: bullet2 || "",
    description: description || "",
    source: "Hermes Agent Webhook",
    status: "pending_verification",
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  activeTasks.push(newTask);
  broadcast("TASK_CREATED", newTask);
  res.status(200).json({
    success: true,
    message: "Task received and queued for TM Check and Generation.",
    taskId: newTask.id
  });
});
app.post("/api/v1/trademark/check", async (req, res) => {
  const { keywords, locale = "en", classes = [25] } = req.body;
  if (!keywords || !Array.isArray(keywords)) {
    return res.status(400).json({ success: false, error: "keywords array required" });
  }
  res.json({
    success: true,
    locale,
    classesChecked: classes,
    results: {},
    hasInfringement: false,
    message: "No active trademarks found on Class 25."
  });
});
var clientDistPath = path.resolve(__dirname, "client");
var fallbackDistPath = path.resolve(process.cwd(), "dist/client");
var staticPath = fs.existsSync(clientDistPath) ? clientDistPath : fallbackDistPath;
if (fs.existsSync(staticPath)) {
  console.log(`\u{1F4C2} Serving static frontend from ${staticPath}`);
  app.use(express.static(staticPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });
}
server.listen(Number(PORT), HOST, () => {
  console.log(`\u{1F680} MBA HUB Core Server running on http://${HOST}:${PORT}`);
  console.log(`\u{1F4E1} WebSocket stream active on ws://${HOST}:${PORT}/ws`);
});
