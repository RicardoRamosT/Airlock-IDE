import { describe, expect, it } from "vitest";
import { parseDeviceCode, parseDeviceToken } from "./device";

describe("parseDeviceCode", () => {
  it("maps GitHub's device-code response", () => {
    expect(
      parseDeviceCode({
        device_code: "d",
        user_code: "WXYZ-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      }),
    ).toEqual({
      deviceCode: "d",
      userCode: "WXYZ-1234",
      verificationUri: "https://github.com/login/device",
      interval: 5,
      expiresIn: 900,
    });
  });
  it("defaults interval/expiry when absent", () => {
    const c = parseDeviceCode({ device_code: "d", user_code: "U" });
    expect(c?.interval).toBe(5);
    expect(c?.expiresIn).toBe(900);
  });
  it("returns null on garbage", () => {
    expect(parseDeviceCode(null)).toBeNull();
    expect(parseDeviceCode({ user_code: "U" })).toBeNull(); // no device_code
  });
});

describe("parseDeviceToken", () => {
  it("ok on access_token", () => {
    expect(parseDeviceToken({ access_token: "T" })).toEqual({
      status: "ok",
      token: "T",
    });
  });
  it("maps the pending/slow_down/expired/denied errors", () => {
    expect(parseDeviceToken({ error: "authorization_pending" })).toEqual({
      status: "pending",
    });
    expect(parseDeviceToken({ error: "slow_down" })).toEqual({
      status: "slow_down",
    });
    expect(parseDeviceToken({ error: "expired_token" })).toEqual({
      status: "expired",
    });
    expect(parseDeviceToken({ error: "access_denied" })).toEqual({
      status: "denied",
    });
  });
  it("error otherwise", () => {
    expect(parseDeviceToken({ error: "bad_verification_code" })).toEqual({
      status: "error",
      error: "bad_verification_code",
    });
  });
});
