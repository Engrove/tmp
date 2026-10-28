(() => {
  'use strict';

  const encoder = new TextEncoder();

  function makeCrcTable() {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
      }
      table[index] = value >>> 0;
    }
    return table;
  }

  const crcTable = makeCrcTable();

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let index = 0; index < bytes.length; index += 1) {
      crc = crcTable[(crc ^ bytes[index]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return encoder.encode(String(value));
  }

  function dosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    const time = ((date.getHours() & 0x1F) << 11) |
      ((date.getMinutes() & 0x3F) << 5) |
      ((Math.floor(date.getSeconds() / 2)) & 0x1F);
    const day = ((year - 1980) << 9) |
      (((date.getMonth() + 1) & 0x0F) << 5) |
      (date.getDate() & 0x1F);
    return { time, date: day };
  }

  function writeU16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function writeU32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  async function deflateRaw(bytes) {
    if (typeof CompressionStream !== 'function' || bytes.byteLength < 64) return null;
    try {
      const input = new Blob([bytes]).stream();
      const compressed = input.pipeThrough(new CompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(compressed).arrayBuffer());
    } catch (_) {
      return null;
    }
  }

  class ZipBuilder {
    constructor() {
      this.entries = [];
    }

    add(name, data, modifiedAt = new Date(), options = {}) {
      const normalizedName = String(name).replaceAll('\\', '/').replace(/^\/+/, '');
      const nameBytes = encoder.encode(normalizedName);
      const bytes = toBytes(data);
      if (bytes.byteLength > 0xFFFFFFFF) throw new Error(`ZIP entry exceeds 4 GiB and ZIP64 is not implemented: ${normalizedName}`);
      this.entries.push({
        name: normalizedName,
        nameBytes,
        bytes,
        crc: crc32(bytes),
        modifiedAt,
        compress: options.compress !== false
      });
    }

    async build() {
      const prepared = [];
      for (const entry of this.entries) {
        let payload = entry.bytes;
        let method = 0;
        if (entry.compress) {
          const compressed = await deflateRaw(entry.bytes);
          if (compressed && compressed.byteLength + 8 < entry.bytes.byteLength) {
            payload = compressed;
            method = 8;
          }
        }
        prepared.push({ ...entry, payload, method });
      }

      const parts = [];
      const centralParts = [];
      let offset = 0;

      for (const entry of prepared) {
        const stamp = dosDateTime(entry.modifiedAt);
        const local = new Uint8Array(30);
        const localView = new DataView(local.buffer);
        writeU32(localView, 0, 0x04034B50);
        writeU16(localView, 4, 20);
        writeU16(localView, 6, 0x0800);
        writeU16(localView, 8, entry.method);
        writeU16(localView, 10, stamp.time);
        writeU16(localView, 12, stamp.date);
        writeU32(localView, 14, entry.crc);
        writeU32(localView, 18, entry.payload.byteLength);
        writeU32(localView, 22, entry.bytes.byteLength);
        writeU16(localView, 26, entry.nameBytes.byteLength);
        writeU16(localView, 28, 0);

        parts.push(local, entry.nameBytes, entry.payload);

        const central = new Uint8Array(46);
        const centralView = new DataView(central.buffer);
        writeU32(centralView, 0, 0x02014B50);
        writeU16(centralView, 4, 20);
        writeU16(centralView, 6, 20);
        writeU16(centralView, 8, 0x0800);
        writeU16(centralView, 10, entry.method);
        writeU16(centralView, 12, stamp.time);
        writeU16(centralView, 14, stamp.date);
        writeU32(centralView, 16, entry.crc);
        writeU32(centralView, 20, entry.payload.byteLength);
        writeU32(centralView, 24, entry.bytes.byteLength);
        writeU16(centralView, 28, entry.nameBytes.byteLength);
        writeU16(centralView, 30, 0);
        writeU16(centralView, 32, 0);
        writeU16(centralView, 34, 0);
        writeU16(centralView, 36, 0);
        writeU32(centralView, 38, 0);
        writeU32(centralView, 42, offset);
        centralParts.push(central, entry.nameBytes);

        offset += local.byteLength + entry.nameBytes.byteLength + entry.payload.byteLength;
        if (offset > 0xFFFFFFFF) throw new Error('ZIP archive exceeds 4 GiB and ZIP64 is not implemented.');
      }

      const centralOffset = offset;
      let centralSize = 0;
      for (const part of centralParts) centralSize += part.byteLength;
      if (centralSize > 0xFFFFFFFF || prepared.length > 0xFFFF) {
        throw new Error('ZIP64 is required but not implemented for this archive size.');
      }
      parts.push(...centralParts);

      const end = new Uint8Array(22);
      const endView = new DataView(end.buffer);
      writeU32(endView, 0, 0x06054B50);
      writeU16(endView, 4, 0);
      writeU16(endView, 6, 0);
      writeU16(endView, 8, prepared.length);
      writeU16(endView, 10, prepared.length);
      writeU32(endView, 12, centralSize);
      writeU32(endView, 16, centralOffset);
      writeU16(endView, 20, 0);
      parts.push(end);

      return new Blob(parts, { type: 'application/zip' });
    }
  }

  globalThis.CgscZip = { ZipBuilder, crc32, deflateRaw };
})();
