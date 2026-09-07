/**
 * Read-only C code viewer. The stored snippet is developer-authored text, but
 * we still escape everything before highlighting so a crafted question can never
 * inject markup. Long lines scroll horizontally; the layout never breaks.
 */
const C_KEYWORDS =
  /\b(?:auto|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|int|long|register|return|short|signed|sizeof|static|struct|switch|typedef|union|unsigned|void|volatile|while)\b/g;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlight(raw: string): string {
  // Minimal, safe tokenizer: comments, strings, preprocessor, keywords, numbers.
  return escapeHtml(raw)
    .replace(/(&quot;.*?&quot;|&#39;.*?&#39;)/g, (m) => `<span class="text-warn">${m}</span>`)
    .replace(/(\/\/.*$|(?:\/\*[\s\S]*?\*\/))/gm, (m) => `<span class="text-fg-faint">${m}</span>`)
    .replace(/(#[a-zA-Z_][a-zA-Z0-9_]*)/g, (m) => `<span class="text-violent">${m}</span>`)
    .replace(C_KEYWORDS, (m) => `<span class="text-info">${m}</span>`)
    .replace(/\b(\d+(?:\.\d+)?)\b/g, (m) => `<span class="text-warn">${m}</span>`);
}

export function CodeBlock({ code, title, fileName }: { code: string; title?: string; fileName?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-ink-700 bg-[#0a0e15]">
      <div className="flex items-center gap-2 border-b border-ink-700/70 px-3 py-1.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-ink-600" />
          <span className="size-2.5 rounded-full bg-ink-600" />
          <span className="size-2.5 rounded-full bg-ink-600" />
        </span>
        <span className="font-mono text-[11px] text-fg-muted">{title ?? fileName ?? 'main.c'}</span>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-relaxed text-fg">
        <code className="block whitespace-pre" dangerouslySetInnerHTML={{ __html: code.length ? highlight(code) : '<span class="text-fg-faint">// no snippet</span>' }} />
      </pre>
    </div>
  );
}