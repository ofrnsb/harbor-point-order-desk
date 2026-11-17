// Next.js calls register() once per server process.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startRefresh } = await import("./platform/refresh.ts");
  startRefresh();
}
