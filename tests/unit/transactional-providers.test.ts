import { describe, it, expect } from "vitest";
import { MockTransactionalProvider, SIMULATED_TRANSACTIONAL_FAILURE_ADDRESS } from "../../src/lib/transactional/providers/mock";

describe("MockTransactionalProvider", () => {
  it("returns a deterministic, self-describing providerMessageId with no network call", async () => {
    const provider = new MockTransactionalProvider();
    const result = await provider.send({
      toAddress: "test@example.test",
      subject: "Hi",
      bodyText: "Hello",
      bodyHtml: "<p>Hello</p>",
      idempotencyKey: "key-1",
    });
    expect(result.providerMessageId).toMatch(/^mock-transactional:/);
  });

  it("deterministically throws for the simulated-failure address", async () => {
    const provider = new MockTransactionalProvider();
    await expect(
      provider.send({
        toAddress: SIMULATED_TRANSACTIONAL_FAILURE_ADDRESS,
        subject: "Hi",
        bodyText: "Hello",
        bodyHtml: "<p>Hello</p>",
        idempotencyKey: "key-2",
      }),
    ).rejects.toThrow();
  });

  it("produces a different providerMessageId per call", async () => {
    const provider = new MockTransactionalProvider();
    const a = await provider.send({ toAddress: "a@example.test", subject: "Hi", bodyText: "x", bodyHtml: "x", idempotencyKey: "key-3" });
    const b = await provider.send({ toAddress: "a@example.test", subject: "Hi", bodyText: "x", bodyHtml: "x", idempotencyKey: "key-4" });
    expect(a.providerMessageId).not.toBe(b.providerMessageId);
  });
});
