import { readFile } from 'node:fs/promises';

/** Reads width and height from a PNG's IHDR chunk. */
export async function pngSize(path: string): Promise<{ width: number; height: number }> {
  const buf = await readFile(path);
  if (buf.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${path} is not a PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
