"use client";
// Client views for lego parts, keyed by part name (same parts as src/lib/lego/parts).
import type { ReactNode } from "react";
import type { BlockCtx } from "../blocks/Blocks";

/** `pageSize` is the agent's page size for this question; views that list rows page by it. */
export type LegoView = (p: { data: any; title: string; ctx: BlockCtx; pageSize?: number }) => ReactNode;
export const VIEWS: Record<string, LegoView> = {};
export const LEGO_FIXTURES = [];
