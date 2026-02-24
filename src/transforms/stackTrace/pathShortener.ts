/**
 * Shorten absolute file paths in stack traces to package-relative paths.
 */

// Strip common path prefixes to make traces more readable.
export function shortenPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');

  // site-packages/package/... → package/...
  const siteIdx = normalized.lastIndexOf('site-packages/');
  if (siteIdx !== -1) return normalized.substring(siteIdx + 'site-packages/'.length);

  // Python stdlib: .../PythonXXX/Lib/foo.py → foo.py
  const libMatch = normalized.match(/Python\d+\/Lib\/(.+)$/);
  if (libMatch) return libMatch[1];

  // Project source: strip common root patterns
  for (const root of ['src/backend/', 'src/frontend/', 'backend/', 'frontend/', 'src/']) {
    const idx = normalized.lastIndexOf(root);
    if (idx !== -1) return normalized.substring(idx + root.length);
  }

  return filePath;
}

export function shortenFilePaths(line: string): string {
  return line.replace(/File "([^"]+)"/g, (_, p) => `File "${shortenPath(p)}"`);
}
