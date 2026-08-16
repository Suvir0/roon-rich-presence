import { describe, expect, it } from 'vitest';
import {
  ROON_SERVICE_ID,
  acceptsDirectedEndpoint,
  encodeSoodQuery,
  endpointFromSoodPacket,
  parseSoodPacket,
  requiresDirectedHostResolution
} from './roon-discovery';

function soodResponse(properties: Record<string, string>): Buffer {
  const chunks: Buffer[] = [Buffer.from('SOOD'), Buffer.from([2]), Buffer.from('R')];
  for (const [name, value] of Object.entries(properties)) {
    const nameBytes = Buffer.from(name);
    const valueBytes = Buffer.from(value);
    const length = Buffer.alloc(2);
    length.writeUInt16BE(valueBytes.length);
    chunks.push(Buffer.from([nameBytes.length]), nameBytes, length, valueBytes);
  }
  return Buffer.concat(chunks);
}

describe('SOOD codec', () => {
  it('encodes a bounded Roon service query', () => {
    const parsed = parseSoodPacket(encodeSoodQuery('transaction'));
    expect(parsed).toEqual({
      type: 'Q',
      properties: { _tid: 'transaction', query_service_id: ROON_SERVICE_ID }
    });
  });

  it('uses the advertised API port and reply address', () => {
    const packet = soodResponse({
      service_id: ROON_SERVICE_ID,
      unique_id: 'core-1',
      http_port: '9312',
      _replyaddr: '192.168.50.2'
    });
    expect(endpointFromSoodPacket(packet, '10.0.0.2')).toEqual({
      uniqueId: 'core-1',
      host: '192.168.50.2',
      port: 9312,
      source: 'automatic'
    });
  });

  it('rejects malformed, unrelated, and invalid-port packets', () => {
    expect(parseSoodPacket(Buffer.from('short'))).toBeUndefined();
    expect(
      endpointFromSoodPacket(
        soodResponse({ service_id: 'other', unique_id: 'x', http_port: '9330' }),
        '192.168.1.2'
      )
    ).toBeUndefined();
    expect(
      endpointFromSoodPacket(
        soodResponse({ service_id: ROON_SERVICE_ID, unique_id: 'x', http_port: '99999' }),
        '192.168.1.2'
      )
    ).toBeUndefined();
  });

  it('accepts only the requested host in directed-only mode', () => {
    const directed = new Set(['roon.local', '192.168.50.2']);
    expect(acceptsDirectedEndpoint('192.168.50.2', '192.168.50.2', directed)).toBe(true);
    expect(acceptsDirectedEndpoint('192.168.50.3', '192.168.50.3', directed)).toBe(false);
  });

  it('resolves a directed hostname before opening discovery sockets', () => {
    expect(requiresDirectedHostResolution('roon.local')).toBe(true);
    expect(requiresDirectedHostResolution('192.168.50.2')).toBe(false);
  });
});
