// The one reader of process.env. Getters read at call time, so values set or loaded after import still apply.

const read = (k: string): string | undefined => process.env[k];

export const env = {
  get production() { return read("NODE_ENV") === "production"; },
  get dataDir() { return read("SIMPUL_DATA_DIR"); },
  get db() { return read("SIMPUL_DB"); },
  /** Where the working ERP lives, when not at the default path (tests point it at a throwaway copy). */
  get erpDb() { return read("SIMPUL_ERP_DB"); },
  /** A deployment without the host's Claude login: every person signs in with their own Anthropic API key. */
  /** Public host names this deployment answers on, comma separated (e.g. harborpoint.example.com). */
  get publicHosts() { return (read("SIMPUL_PUBLIC_HOSTS") ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean); },
  get agentKeyRequired() { return read("SIMPUL_AGENT_KEY_REQUIRED") === "true"; },
  get tenant() { return read("SIMPUL_TENANT"); },
  get masterKey() { return read("SIMPUL_MASTER_KEY"); },
  get setupToken() { return read("SIMPUL_SETUP_TOKEN"); },
  /** The password the seed gives every seeded account. Never stored in the repository. */
  get seedPassword() { return read("SIMPUL_SEED_PASSWORD"); },
  get insecureCookies() { return read("SIMPUL_INSECURE_COOKIES") === "1"; },
  get trustedEmailHeader() { return read("SIMPUL_TRUSTED_EMAIL_HEADER"); },
  get litellmUrl() { return read("LITELLM_URL"); },
  get litellmKey() { return read("LITELLM_MASTER_KEY"); },
  get claudeProfile() { return read("APP_CLAUDE_PROFILE"); },
  get claudeProfiles() { return read("APP_CLAUDE_PROFILES"); },
  get claudeConfigDir() { return read("CLAUDE_CONFIG_DIR"); },
  get claudeOauthToken() { return read("CLAUDE_CODE_OAUTH_TOKEN"); },
  /** Where the app's own Codex login lives (CODEX_HOME for the agent), apart from the developer's ~/.codex. */
  get codexHome() { return read("APP_CODEX_HOME"); },
  get osUser() { return read("USER"); },
  get appUrl() { return read("APP_URL"); },
  get verifyAgent() { return read("VERIFY_AGENT") !== "0"; },
  get verifyModel() { return read("VERIFY_MODEL"); },
  get foundationShell() { return read("FOUNDATION_SHELL") === "1"; },
  /** Any variable by name, for code that resolves names from configuration. */
  get: read,
};
