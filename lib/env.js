// Load ./.env if present (Node 20.12+). Imported first so every module sees it.
import fs from "node:fs";
if (fs.existsSync(".env")) process.loadEnvFile(".env");
