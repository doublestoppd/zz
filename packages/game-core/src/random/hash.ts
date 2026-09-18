/**
 * FNV-1a 32-bit hash of a string. Used to fold a stable identifier (a container id) into a
 * seed so the same match seed and the same object always roll the same loot, whatever
 * order players search in.
 */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
