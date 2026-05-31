import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"]
]);

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);
    let filePath = decodeURIComponent(requestUrl.pathname);
    if (filePath === "/") filePath = "/index.html";
    const absolute = path.resolve(root, `.${filePath}`);

    if (!absolute.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const data = await fs.readFile(absolute);
    res.writeHead(200, {
      "Content-Type": types.get(path.extname(absolute)) || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  } catch (error) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${port} 已被占用，请使用 PORT=其他端口 npm start。`);
    process.exitCode = 1;
    return;
  }
  if (error.code === "EPERM") {
    console.error("当前环境不允许启动本地预览服务。可直接部署为 HTTPS 静态站点后用手机访问。");
    process.exitCode = 1;
    return;
  }
  console.error(error);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`智驾测试记录仪已启动: http://${host}:${port}`);
});
