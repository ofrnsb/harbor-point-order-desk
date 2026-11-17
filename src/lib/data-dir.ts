// Where one installation keeps its state (store, chats, actions, keys, file-based systems).
// SIMPUL_DATA_DIR lets several installations run from one checkout, each with its own company.
import path from "node:path";
import { env } from "../config/env.ts";

export const DATA_DIR = path.resolve(env.dataDir ?? path.join(process.cwd(), "data"));
