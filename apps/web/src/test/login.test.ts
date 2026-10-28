import { describe, expect, it } from "vitest";
import { admin, common } from "../copy";
import { loginError } from "../pages/Login";

describe("login error messages", () => {
  it("explains https_required instead of a generic error (audit M3)", () => {
    expect(loginError("https_required")).toBe(admin.httpsRequired);
    expect(admin.httpsRequired).toMatch(/HTTPS/);
  });

  it("keeps the other messages", () => {
    expect(loginError("invalid_credentials")).toBe(admin.badLogin);
    expect(loginError("rate_limited")).toBe(admin.rateLimited);
    expect(loginError("network_error")).toBe(common.offline);
    expect(loginError("something_else")).toBe(common.error);
  });
});
