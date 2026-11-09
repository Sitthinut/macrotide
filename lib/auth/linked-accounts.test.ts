import { describe, expect, it } from "vitest";
import { type LinkedAccount, unlinkTargetId } from "./linked-accounts";

const accounts: LinkedAccount[] = [
  { id: "row-credential", providerId: "credential", accountId: "user-1" },
  { id: "row-google", providerId: "google", accountId: "google-sub-123" },
];

describe("unlinkTargetId", () => {
  it("returns the local account row id for the provider", () => {
    expect(unlinkTargetId(accounts, "google")).toBe("row-google");
  });

  it("never returns the provider name or the provider's user id", () => {
    const id = unlinkTargetId(accounts, "google");
    expect(id).not.toBe("google");
    expect(id).not.toBe("google-sub-123");
  });

  it("returns null when the provider isn't linked", () => {
    expect(unlinkTargetId(accounts, "github")).toBeNull();
    expect(unlinkTargetId([], "google")).toBeNull();
  });

  it("returns null before the account list has loaded", () => {
    expect(unlinkTargetId(null, "google")).toBeNull();
    expect(unlinkTargetId(undefined, "google")).toBeNull();
  });
});
