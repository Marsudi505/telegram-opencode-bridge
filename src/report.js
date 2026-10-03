const VISIBLE_FILE_LIMIT = 25;

export function splitText(text, limit = 4000) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const effective = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : Number.MAX_SAFE_INTEGER;
  if (text.length <= effective) return [text];
  const parts = [];
  for (let index = 0; index < text.length; index += effective) {
    parts.push(text.slice(index, index + effective));
  }
  return parts;
}

export function formatReport({ answer, changedFiles, sha, branch, sessionId }) {
  const lines = [];
  lines.push(`✅ Selesai — commit ${sha}`, '');
  lines.push('Jawaban AI:');
  const text = answer?.trim();
  lines.push(text ? text : '_(tidak ada output teks)_');
  lines.push('');
  lines.push(`File yang berubah (${changedFiles.length}):`);
  const visible = changedFiles.slice(0, VISIBLE_FILE_LIMIT);
  for (const file of visible) lines.push(`  ${file}`);
  if (changedFiles.length > VISIBLE_FILE_LIMIT) {
    const hidden = changedFiles.length - VISIBLE_FILE_LIMIT;
    lines.push(`  +${hidden} file lain tidak ditampilkan`);
  }
  lines.push('');
  lines.push(`Branch: ${branch} → origin/${branch}`);
  if (sessionId) lines.push(`Sesi: ${sessionId} (aktif untuk /ai berikutnya)`);
  return lines.join('\n');
}
