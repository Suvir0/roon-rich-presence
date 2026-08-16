/**
 * requestLocalNetworkAccess — trigger the macOS Local Network privacy prompt.
 *
 * On current macOS releases, the OS shows a one-time "allow local network" dialog the first
 * time the application performs a local-network operation and the app has an
 * NSLocalNetworkUsageDescription in its Info.plist.
 *
 * Establish a connected UDP socket to Roon's SOOD multicast address without sending
 * application data. This is a best-effort BSD-socket equivalent of Apple's TN3179
 * guidance: keep the operation alive long enough for macOS to attribute it to the
 * visible app and show the privacy prompt. Discovery and WebSocket code still owns all
 * actual Roon traffic.
 *
 * Call this once after the window is visible and before starting Roon discovery.
 * On non-macOS platforms this is a no-op.
 */

import { createSocket } from 'node:dgram';

const SOOD_MULTICAST = '239.255.90.90';
const PERMISSION_PROBE_PORT = 9;
const TIMEOUT_MS = 3_000;

/** Starts the permission-attribution operation before any Roon LAN work. */
export function beginVisibleNetworkAccess(
  requestAccess: () => Promise<void>,
  startConnectivity: () => void
): Promise<void> {
  const pendingAccess = requestAccess();
  startConnectivity();
  return pendingAccess;
}

export function requestLocalNetworkAccess(platform = process.platform): Promise<void> {
  if (platform !== 'darwin') return Promise.resolve();

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
    // A successful UDP connect is immediate and sends no packet. Keep the socket
    // alive until the bounded timeout so macOS has time to display and resolve the
    // Local Network privacy prompt while the app remains visible.
    socket.connect(PERMISSION_PROBE_PORT, SOOD_MULTICAST);
  });
}
