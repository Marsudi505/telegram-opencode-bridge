const SENSITIVE_BASENAMES = new Set([
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'credentials',
  '.netrc',
  '.pgpass',
]);

const SENSITIVE_PATTERNS = [
  /\.env(\.|$)/,
  /\.key$/,
  /\.pem$/,
  /\.p12$/,
  /\.pfx$/,
  /\.keystore$/,
  /credentials/i,
  /service.?account/i,
  /\bsecrets?\b/i,
  /\.npmrc$/,
];

export function screenSensitiveFiles(files) {
  return files.filter((file) => {
    const normalized = file.replaceAll('\\', '/');
    const basename = normalized.split('/').pop();
    if (basename.endsWith('.example')) return false;
    if (SENSITIVE_BASENAMES.has(basename)) return true;
    return SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalized));
  });
}
