/**
 * requestLocalNetworkAccess — trigger the macOS Local Network privacy prompt.
 *
 * On macOS 10.15+, the OS shows a one-time "allow local network" dialog the first
 * time the application performs a local-network operation and the app has an
 * NSLocalNetworkUsageDescription in its Info.plist.
 *
 * Node's dgram/ws sockets alone don't reliably trigger that dialog in packaged Electron
 * apps without an Apple Developer Team ID. The cross-app technique (used by VS Code,
 * Cursor, etc.) is to send a minimal UDP packet to the mDNS multicast address
 * (224.0.0.251:5353) *from the .app bundle process itself*.  macOS attributes the
 * operation to the bundle, shows the dialog, and — if the user clicks Allow — grants
 * the permission for all subsequent network operations including SOOD and WebSocket.
 *
 * Call this once, early in app startup, before starting Roon discovery.
 * On non-macOS platforms this is a no-op.
 */

import { createSocket } from 'node:dgram';

const MDNS_MULTICAST = '224.0.0.251';
const MDNS_PORT = 5353;
const TIMEOUT_MS = 3_000;

export function requestLocalNetworkAccess(): Promise<void> {
  if (process.platform !== 'darwin') return Promise.resolve();

  return new Promise<void>((resolve) => {
    const socket = createSocket('udp4');
    let settled = false;

    const done = () => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        // Already closed
      }
      resolve();
    };

    const failSafe = setTimeout(done, TIMEOUT_MS);
    if (failSafe.unref) failSafe.unref();

    socket.once('error', done);
    socket.bind(0, () => {
      socket.send(Buffer.alloc(1), MDNS_PORT, MDNS_MULTICAST, done);
    });
  });
}
