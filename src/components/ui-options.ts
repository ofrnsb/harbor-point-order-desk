// The optional design decisions a product records in src/domain/ui.ts, read through one typed view so a product can
// write them with `as const` (literal types) and the shell still compares and defaults them safely.
import { ui } from "@/domain/ui";
import type { HomeSection } from "./home-data";

export type LayoutMode = "horizon" | "workbench" | "editorial";

type UiOptions = {
  layout?: LayoutMode;
  home?: readonly HomeSection[];
  homeVisual?: "side" | "wide";
  motionScale?: number;
};

const options = ui as unknown as UiOptions;

export const uiLayout: LayoutMode = options.layout ?? "editorial";
export const uiHome: readonly HomeSection[] | undefined = options.home;
export const uiHomeVisual: "side" | "wide" = options.homeVisual ?? "side";
export const uiMotionScale: number = options.motionScale ?? 1;
