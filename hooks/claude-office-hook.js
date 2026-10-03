#!/usr/bin/env node
/* =========================================================================
 * Hook Claude Code → Visual Office.
 * Membaca JSON event dari stdin lalu mengirimnya ke server Visual Office,
 * sehingga setiap sesi Claude Code muncul sebagai karyawan di kantor.
 * Tidak pernah memblokir Claude Code: selalu keluar dengan kode 0.
 *
 * Variabel lingkungan: VISUAL_OFFICE_URL (default http://localhost:4317)
 * ========================================================================= */
const url = (process.env.VISUAL_OFFICE_URL || 'http://localhost:4317') + '/api/event';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', async () => {
  try {
    const ev = JSON.parse(input || '{}');
    // kirim seperlunya saja (hindari mengirim isi file besar)
    const slim = {
      hook_event_name: ev.hook_event_name,
      session_id: ev.session_id,
      cwd: ev.cwd,
      tool_name: ev.tool_name,
      tool_input: ev.tool_input && {
        file_path: ev.tool_input.file_path,
        path: ev.tool_input.path,
        command: typeof ev.tool_input.command === 'string' ? ev.tool_input.command.slice(0, 120) : undefined,
        pattern: ev.tool_input.pattern,
        description: ev.tool_input.description,
      },
      prompt: typeof ev.prompt === 'string' ? ev.prompt.slice(0, 300) : undefined,
      message: ev.message,
    };
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(slim),
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    /* server mati / tidak jalan — abaikan */
  }
  process.exit(0);
});
