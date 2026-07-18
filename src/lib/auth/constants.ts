// No `server-only` guard: this is just a string, and it must stay importable
// from src/proxy.ts, which runs outside the "react-server" bundler condition.
export const SESSION_COOKIE_NAME = "session";
