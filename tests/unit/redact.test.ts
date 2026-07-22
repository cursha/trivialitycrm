import { describe, it, expect } from "vitest";
import { redactSensitiveData } from "../../src/lib/audit/redact";

describe("redactSensitiveData", () => {
  it("redacts known sensitive keys at the top level", () => {
    const result = redactSensitiveData({ password: "hunter2", passwordHash: "abc", tokenHash: "def", apiKey: "ghi", name: "Jane" });
    expect(result).toEqual({ password: "[redacted]", passwordHash: "[redacted]", tokenHash: "[redacted]", apiKey: "[redacted]", name: "Jane" });
  });

  it("redacts nested sensitive keys at any depth", () => {
    const result = redactSensitiveData({ user: { credentials: { secret: "s3cr3t", authorization: "Bearer xyz" } } });
    expect(result).toEqual({ user: { credentials: { secret: "[redacted]", authorization: "[redacted]" } } });
  });

  it("redacts sensitive keys inside arrays of objects", () => {
    const result = redactSensitiveData([{ cookie: "session=abc" }, { name: "ok" }]);
    expect(result).toEqual([{ cookie: "[redacted]" }, { name: "ok" }]);
  });

  it("is case-insensitive and matches partial key names", () => {
    const result = redactSensitiveData({ DATABASE_CONNECTIONSTRING: "postgres://...", MyApiKeyValue: "xyz" });
    expect(result).toEqual({ DATABASE_CONNECTIONSTRING: "[redacted]", MyApiKeyValue: "[redacted]" });
  });

  it("leaves non-sensitive primitive values untouched", () => {
    expect(redactSensitiveData("hello")).toBe("hello");
    expect(redactSensitiveData(42)).toBe(42);
    expect(redactSensitiveData(null)).toBeNull();
  });
});
