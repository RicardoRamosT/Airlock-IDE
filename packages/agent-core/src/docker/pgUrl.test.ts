import { describe, expect, it } from "vitest";
import { dockerPostgresUrl, parseEnvPairs, withDatabase } from "./pgUrl";

describe("parseEnvPairs", () => {
  it("splits on the FIRST separator, so a value may contain '='", () => {
    // Base64 passwords end in "=" padding; splitting greedily would truncate.
    const e = parseEnvPairs(["POSTGRES_PASSWORD=aGVsbG8=", "PATH=/usr/bin"]);
    expect(e.POSTGRES_PASSWORD).toBe("aGVsbG8=");
    expect(e.PATH).toBe("/usr/bin");
  });

  it("ignores entries with no key", () => {
    expect(parseEnvPairs(["", "NOSEP", "=novalue"])).toEqual({});
  });
});

describe("dockerPostgresUrl", () => {
  const env = [
    "POSTGRES_USER=app",
    "POSTGRES_PASSWORD=s3cret",
    "POSTGRES_DB=helm",
  ];

  it("builds a URL from the container's own env", () => {
    expect(dockerPostgresUrl(env, 5432)).toBe(
      "postgres://app:s3cret@127.0.0.1:5432/helm",
    );
  });

  it("defaults the user to postgres", () => {
    expect(dockerPostgresUrl(["POSTGRES_PASSWORD=p"], 5432)).toBe(
      "postgres://postgres:p@127.0.0.1:5432/postgres",
    );
  });

  it("defaults the DATABASE to the user, not to 'postgres'", () => {
    // The official image's actual rule. Defaulting to "postgres" here yields
    // "database does not exist" against a server that is working fine.
    expect(
      dockerPostgresUrl(["POSTGRES_USER=app", "POSTGRES_PASSWORD=p"], 5432),
    ).toBe("postgres://app:p@127.0.0.1:5432/app");
  });

  it("returns null when there is no published host port", () => {
    // Reachable only inside the docker network -- a URL would never connect.
    expect(dockerPostgresUrl(env, null)).toBeNull();
  });

  it("returns null when no password is set and trust auth is off", () => {
    // Better an honest "no credentials" than an opaque connection error.
    expect(dockerPostgresUrl(["POSTGRES_USER=app"], 5432)).toBeNull();
  });

  it("allows an empty password under trust auth", () => {
    expect(
      dockerPostgresUrl(
        ["POSTGRES_USER=app", "POSTGRES_HOST_AUTH_METHOD=trust"],
        5432,
      ),
    ).toBe("postgres://app:@127.0.0.1:5432/app");
  });

  it("percent-encodes credentials, so a password cannot re-point the host", () => {
    // "p@ss/word" unencoded would make "ss" the host and truncate the port.
    const url = dockerPostgresUrl(
      ["POSTGRES_USER=a b", "POSTGRES_PASSWORD=p@ss/word", "POSTGRES_DB=d"],
      5432,
    );
    expect(url).toBe("postgres://a%20b:p%40ss%2Fword@127.0.0.1:5432/d");
    expect(new URL(url as string).hostname).toBe("127.0.0.1");
    expect(new URL(url as string).port).toBe("5432");
  });
});

describe("withDatabase", () => {
  it("swaps the database while keeping the credentials", () => {
    const url = withDatabase("postgres://app:p@127.0.0.1:5432/app", "other");
    expect(url).toBe("postgres://app:p@127.0.0.1:5432/other");
  });

  it("encodes a database name that needs it", () => {
    expect(
      withDatabase("postgres://app:p@127.0.0.1:5432/app", "my db"),
    ).toContain("/my%20db");
  });
});
