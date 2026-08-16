import { createSocket, type Socket } from 'node:dgram';
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIPv4 } from 'node:net';
import { networkInterfaces } from 'node:os';

export const ROON_SOOD_PORT = 9003;
export const ROON_SOOD_MULTICAST = '239.255.90.90';
export const ROON_SERVICE_ID = '00720724-5143-4a9b-abac-0e50cba674bb';

export interface RoonDiscoveredEndpoint {
  uniqueId: string;
  host: string;
  port: number;
  source: 'automatic' | 'directed';
}

interface ParsedSoodMessage {
  type: string;
  properties: Record<string, string | null>;
}

export function encodeSoodQuery(transactionId: string = randomUUID()): Buffer {
  const properties = {
    _tid: transactionId,
    query_service_id: ROON_SERVICE_ID
  };
  const chunks: Buffer[] = [Buffer.from([0x53, 0x4f, 0x4f, 0x44, 0x02, 0x51])];
  for (const [name, value] of Object.entries(properties)) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const valueBuffer = Buffer.from(value, 'utf8');
    if (nameBuffer.length > 255 || valueBuffer.length > 65_534) continue;
    const header = Buffer.allocUnsafe(3);
    header[0] = nameBuffer.length;
    header.writeUInt16BE(valueBuffer.length, 1);
    chunks.push(Buffer.from([nameBuffer.length]), nameBuffer, header.subarray(1), valueBuffer);
  }
  return Buffer.concat(chunks);
}

export function parseSoodPacket(packet: Buffer): ParsedSoodMessage | undefined {
  if (packet.length < 6 || packet.toString('utf8', 0, 4) !== 'SOOD' || packet[4] !== 2) {
    return undefined;
  }
  const type = packet.toString('utf8', 5, 6);
  const properties: Record<string, string | null> = {};
  let offset = 6;
  while (offset < packet.length) {
    const nameLength = packet[offset++];
    if (!nameLength || offset + nameLength + 2 > packet.length) return undefined;
    const name = packet.toString('utf8', offset, offset + nameLength);
    offset += nameLength;
    const valueLength = packet.readUInt16BE(offset);
    offset += 2;
    if (valueLength === 0xffff) {
      properties[name] = null;
      continue;
    }
    if (offset + valueLength > packet.length) return undefined;
    properties[name] = packet.toString('utf8', offset, offset + valueLength);
    offset += valueLength;
  }
  return { type, properties };
}

export function endpointFromSoodPacket(
  packet: Buffer,
  senderHost: string,
  directedHost?: string
): RoonDiscoveredEndpoint | undefined {
  const message = parseSoodPacket(packet);
  if (!message || message.properties.service_id !== ROON_SERVICE_ID) return undefined;
  const uniqueId = message.properties.unique_id;
  const port = Number(message.properties.http_port);
  const replyHost = message.properties._replyaddr;
  const host = typeof replyHost === 'string' && replyHost ? replyHost : senderHost;
  if (!uniqueId || !Number.isInteger(port) || port < 1 || port > 65_535 || !host) return undefined;
  return {
    uniqueId,
    host,
    port,
    source: directedHost && host === directedHost ? 'directed' : 'automatic'
  };
}

export interface RoonDiscoveryOptions {
  directedHost?: string;
  directedOnly?: boolean;
  onEndpoint(endpoint: RoonDiscoveredEndpoint): void;
  onError?(error: Error): void;
}

/** Owns SOOD sockets so discovery behavior is observable and independent of node-roon-api internals. */
export class RoonDiscovery {
  private readonly sockets = new Set<Socket>();
  private readonly senderSockets = new Set<Socket>();
  private queryTimer?: NodeJS.Timeout;
  private refreshTimer?: NodeJS.Timeout;
  private interfaceSignature = '';
  private stopped = true;
  private readonly directedAddresses = new Set<string>();
  private socketGeneration = 0;
  private lifecycleGeneration = 0;

  constructor(private readonly options: RoonDiscoveryOptions) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const lifecycle = ++this.lifecycleGeneration;
    this.directedAddresses.clear();
    if (this.options.directedHost) {
      this.directedAddresses.add(this.options.directedHost);
      if (requiresDirectedHostResolution(this.options.directedHost)) {
        void this.resolveDirectedHost(this.options.directedHost, lifecycle);
      } else {
        this.rebuildSockets();
      }
    } else {
      this.rebuildSockets();
    }
    this.queryTimer = setInterval(() => this.query(), 10_000);
    this.queryTimer.unref();
    this.refreshTimer = setInterval(() => this.refreshInterfaces(), 5_000);
    this.refreshTimer.unref();
  }

  private async resolveDirectedHost(host: string, lifecycle: number): Promise<void> {
    try {
      const addresses = await lookup(host, { all: true, family: 4 });
      if (this.stopped || lifecycle !== this.lifecycleGeneration) return;
      for (const address of addresses) this.directedAddresses.add(address.address);
    } catch (error) {
      if (!this.stopped && lifecycle === this.lifecycleGeneration) this.report(error);
    }
    if (!this.stopped && lifecycle === this.lifecycleGeneration) this.rebuildSockets();
  }

  stop(): void {
    this.stopped = true;
    this.lifecycleGeneration += 1;
    this.socketGeneration += 1;
    if (this.queryTimer) clearInterval(this.queryTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    delete this.queryTimer;
    delete this.refreshTimer;
    for (const socket of this.sockets) {
      try {
        socket.close();
      } catch {
        // The socket may already have closed after an OS-level network error.
      }
    }
    this.sockets.clear();
    this.senderSockets.clear();
  }

  query(): void {
    if (this.stopped) return;
    for (const socket of this.senderSockets) this.sendQuery(socket);
  }

  private refreshInterfaces(): void {
    const signature = ipv4Interfaces()
      .map((entry) => `${entry.address}/${entry.netmask}`)
      .sort()
      .join(',');
    if (signature !== this.interfaceSignature) this.rebuildSockets();
  }

  private rebuildSockets(): void {
    if (this.stopped) return;
    const generation = ++this.socketGeneration;
    for (const socket of this.sockets) {
      try {
        socket.close();
      } catch {
        // ignored
      }
    }
    this.sockets.clear();
    this.senderSockets.clear();
    const interfaces = ipv4Interfaces();
    this.interfaceSignature = interfaces
      .map((entry) => `${entry.address}/${entry.netmask}`)
      .sort()
      .join(',');

    const receiver = createSocket({ type: 'udp4', reuseAddr: true });
    this.observe(receiver, generation);
    this.sockets.add(receiver);
    receiver.bind(ROON_SOOD_PORT, () => {
      if (!this.isCurrent(receiver, generation)) return;
      for (const entry of interfaces) {
        try {
          receiver.addMembership(ROON_SOOD_MULTICAST, entry.address);
        } catch (error) {
          this.report(error);
        }
      }
    });
    for (const entry of interfaces) {
      const sender = createSocket('udp4') as Socket & { rrpBroadcast?: string };
      sender.rrpBroadcast = broadcastAddress(entry.address, entry.netmask);
      this.observe(sender, generation);
      this.sockets.add(sender);
      this.senderSockets.add(sender);
      sender.bind({ port: 0, address: entry.address }, () => {
        if (!this.isCurrent(sender, generation)) return;
        try {
          sender.setBroadcast(true);
          sender.setMulticastInterface(entry.address);
          sender.setMulticastTTL(1);
        } catch (error) {
          this.report(error);
        }
        this.sendQuery(sender);
      });
    }
  }

  private observe(socket: Socket, generation: number): void {
    socket.on('message', (packet, sender) => {
      if (!this.isCurrent(socket, generation)) return;
      const endpoint = endpointFromSoodPacket(packet, sender.address, this.options.directedHost);
      if (!endpoint) return;
      if (this.options.directedOnly) {
        if (!acceptsDirectedEndpoint(sender.address, endpoint.host, this.directedAddresses)) return;
        endpoint.source = 'directed';
      }
      this.options.onEndpoint(endpoint);
    });
    socket.on('error', (error) => {
      if (this.isCurrent(socket, generation)) this.report(error);
      try {
        socket.close();
      } catch {
        // ignored
      }
      this.sockets.delete(socket);
      this.senderSockets.delete(socket);
    });
  }

  private sendQuery(socket: Socket): void {
    if (!this.senderSockets.has(socket)) return;
    const packet = encodeSoodQuery();
    if (!this.options.directedOnly) {
      this.safeSend(socket, packet, ROON_SOOD_MULTICAST);
      const broadcast = (socket as Socket & { rrpBroadcast?: string }).rrpBroadcast;
      if (broadcast) this.safeSend(socket, packet, broadcast);
    }
    if (this.options.directedHost) this.safeSend(socket, packet, this.options.directedHost);
  }

  private safeSend(socket: Socket, packet: Buffer, host: string): void {
    try {
      socket.send(packet, ROON_SOOD_PORT, host, (error) => {
        if (error && this.senderSockets.has(socket) && !this.stopped) this.report(error);
      });
    } catch (error) {
      this.report(error);
    }
  }

  private isCurrent(socket: Socket, generation: number): boolean {
    return !this.stopped && generation === this.socketGeneration && this.sockets.has(socket);
  }

  private report(error: unknown): void {
    this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
  }
}

export function acceptsDirectedEndpoint(
  senderHost: string,
  advertisedHost: string,
  directedAddresses: ReadonlySet<string>
): boolean {
  return directedAddresses.has(senderHost) || directedAddresses.has(advertisedHost);
}

export function requiresDirectedHostResolution(host: string): boolean {
  return !isIPv4(host);
}

function ipv4Interfaces(): { address: string; netmask: string }[] {
  return Object.values(networkInterfaces()).flatMap((entries) =>
    (entries ?? []).flatMap((entry) =>
      entry.family === 'IPv4' && !entry.internal
        ? [{ address: entry.address, netmask: entry.netmask }]
        : []
    )
  );
}

function broadcastAddress(address: string, netmask: string): string {
  const ip = address.split('.').map(Number);
  const mask = netmask.split('.').map(Number);
  return ip.map((part, index) => part | (~(mask[index] ?? 0) & 255)).join('.');
}
