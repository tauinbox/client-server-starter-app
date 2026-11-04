export function escapeLikePattern(value: string): string {
  return value.replaceAll(/[%_\\]/g, '\\$&');
}
