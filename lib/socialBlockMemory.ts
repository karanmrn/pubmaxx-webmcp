const blocks = new Set<string>();

export function socialMemoryBlocked(first: string, second: string): boolean {
  return blocks.has(`${first}:${second}`) || blocks.has(`${second}:${first}`);
}

export function setSocialMemoryBlock(first: string, second: string, active: boolean): void {
  const key = `${first}:${second}`;
  if (active) blocks.add(key); else blocks.delete(key);
}

export function socialMemoryBlockedProfiles(profileId: string): Set<string> {
  const result = new Set<string>();
  for (const key of blocks) {
    const [first, second] = key.split(":");
    if (first === profileId && second) result.add(second);
    if (second === profileId && first) result.add(first);
  }
  return result;
}

export function clearSocialMemoryBlocks(): void { blocks.clear(); }
