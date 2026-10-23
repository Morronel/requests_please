/** Rough "this smells" check used for Easy-mode glow. It flags bait too, on purpose. */
const SMELLS = [
  /['"`]\s*(or|and|;|\)|--)/i,
  /\b(union|select|sleep|drop|benchmark)\b/i,
  /<\s*(script|img|svg|iframe)|on\w+\s*=|javascript:/i,
  /\.\.[\\/]/,
  /etc\/passwd|\.env\b|\.git\b/,
  /sqlmap|nikto|zgrab|masscan|nuclei|googlebot/i,
  /;\s*(cat|ls|id|rm|wget|curl|nc|bash|sh)\b|\$\(|`|\|\s*(nc|sh|bash)\b/,
  /169\.254|localhost|127\.0\.0\.1|0x7f|\[::1\]|gopher:/i,
  /\{\{|\$\{|<%/,
  /<!DOCTYPE|<!ENTITY/i,
  /^\/\/|@[a-z-]+\.[a-z]+/i,
  /%[0-9a-f]{2}|&#x|\\x[0-9a-f]{2}/i,
];

export function smells(value: string): boolean {
  return SMELLS.some((r) => r.test(value));
}
