import { defineConfig } from "drizzle-kit";
import os from "node:os";
import path from "node:path";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: path.join(os.homedir(), ".resume-video", "resume-video.db"),
  },
});
