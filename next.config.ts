import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "better-sqlite3", "pg", "mysql2", "mongodb", "oracledb", "mssql", "@duckdb/node-api", "exceljs", "kafkajs", "jszip"],
  devIndicators: false,
  // One build folder per installation, so several companies can run in dev from one checkout.
  distDir: process.env.SIMPUL_DIST_DIR ?? ".next",
};

export default config;
