import { describe, it, expect } from "vitest";
import { isBounceMessage } from "../../src/lib/comms/inbound-sync";

describe("isBounceMessage", () => {
  it("recognizes a postmaster@ sender", () => {
    expect(isBounceMessage({ fromAddress: "postmaster@example.com", subject: "anything" })).toBe(true);
  });

  it("recognizes a mailer-daemon@ sender, case-insensitively", () => {
    expect(isBounceMessage({ fromAddress: "MAILER-DAEMON@example.com", subject: "anything" })).toBe(true);
  });

  it("recognizes a common bounce subject line even from an unrecognized sender", () => {
    expect(isBounceMessage({ fromAddress: "notify@mail.example.com", subject: "Undeliverable: Re: Demo follow-up" })).toBe(true);
    expect(isBounceMessage({ fromAddress: "notify@mail.example.com", subject: "Delivery has failed to these recipients" })).toBe(true);
    expect(isBounceMessage({ fromAddress: "notify@mail.example.com", subject: "Mail delivery failed: returning message to sender" })).toBe(
      true,
    );
  });

  it("does not flag an ordinary reply", () => {
    expect(isBounceMessage({ fromAddress: "lead@example.com", subject: "Re: Demo follow-up" })).toBe(false);
  });
});
