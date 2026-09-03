export function savedListPath(ownerHandle: string, listType: string): string {
  return `/u/${encodeURIComponent(ownerHandle)}/lists/${encodeURIComponent(listType)}`;
}
