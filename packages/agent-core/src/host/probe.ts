import { createConnection } from "node:net";

// Real adapter (untested-edge like fetchTransport). The PortProber type is the
// DI seam so consumers/tests can substitute it.
export type PortProber = (
  host: string,
  port: number,
  timeoutMs?: number,
) => Promise<boolean>;

export const probePort: PortProber = (host, port, timeoutMs = 500) =>
  new Promise((resolve) => {
    const sock = createConnection({ host, port });
    const done = (up: boolean) => {
      sock.destroy();
      resolve(up);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
