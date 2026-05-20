"""Render a synced bulletin as a print-styled HTML page.

Kept as a separate module so the styling stays maintainable. The user opens
the rendered page in a new window and uses Cmd-P → Save as PDF.
"""

from __future__ import annotations

import html
from typing import Any


def render(b: dict[str, Any]) -> str:
    def esc(v: Any) -> str:
        return html.escape("" if v is None else str(v))

    head_lines: list[str] = []
    if b.get("student_name"):
        head_lines.append(f"<div class='who'>{esc(b['student_name'])}</div>")
    sub_bits = []
    if b.get("class_name"):
        sub_bits.append(f"Classe {esc(b['class_name'])}")
    if b.get("establishment"):
        sub_bits.append(esc(b["establishment"]))
    if sub_bits:
        head_lines.append(f"<div class='sub'>{' &middot; '.join(sub_bits)}</div>")

    if b.get("start_date") and b.get("end_date"):
        head_lines.append(
            f"<div class='period-range'>{esc(b['start_date'][:10])} → {esc(b['end_date'][:10])}</div>"
        )

    rows = []
    for s in b.get("subjects", []):
        coef = s.get("coefficient")
        coef_s = f"&times;{coef:g}" if coef is not None else ""
        teachers = ", ".join(s.get("teachers") or [])
        comments = s.get("comments") or []
        comment_html = "".join(
            f"<p class='comment'>{esc(c)}</p>" for c in comments if c
        ) or "<p class='comment muted'><em>No comment.</em></p>"
        rows.append(f"""
          <section class='subject'>
            <header>
              <h3>{esc(s['subject_name'])}</h3>
              <div class='meta'>
                <span class='avg'>
                  <strong>{esc(s.get('student_average'))}</strong>
                  <span class='cls'> / class {esc(s.get('class_average'))}</span>
                </span>
                <span class='range'>min {esc(s.get('min_average'))} · max {esc(s.get('max_average'))}</span>
                <span class='coef'>{coef_s}</span>
              </div>
              {f"<div class='teachers'>{esc(teachers)}</div>" if teachers else ""}
            </header>
            {comment_html}
          </section>
        """)

    globals_html = "".join(
        f"<p>{esc(c)}</p>" for c in (b.get("global_comments") or []) if c
    )

    return f"""<!doctype html>
<html lang='fr'>
<head>
  <meta charset='utf-8'>
  <title>Bulletin — {esc(b.get('period_name'))}</title>
  <style>
    @page {{ size: A4; margin: 18mm 16mm; }}
    html, body {{
      background: #fff;
      color: #1a1a1a;
      font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
      font-size: 11pt;
      line-height: 1.45;
    }}
    body {{ max-width: 760px; margin: 0 auto; padding: 24px; }}
    header.page {{ border-bottom: 2px solid #1a3f86; padding-bottom: 12px; margin-bottom: 18px; }}
    header.page h1 {{ margin: 0 0 4px; font-size: 22pt; color: #1a3f86; }}
    .who {{ font-size: 13pt; font-weight: 600; }}
    .sub, .period-range {{ color: #555; font-size: 10pt; }}
    .period-range {{ margin-top: 2px; }}
    .global {{
      background: #f4f7fc;
      border-left: 3px solid #1a3f86;
      padding: 10px 14px;
      margin: 0 0 18px;
      font-style: italic;
    }}
    .global h2 {{
      font-size: 11pt; font-style: normal; margin: 0 0 4px;
      color: #1a3f86; text-transform: uppercase; letter-spacing: 0.06em;
    }}
    section.subject {{
      page-break-inside: avoid;
      border-top: 1px solid #ddd;
      padding: 10px 0;
    }}
    section.subject:first-of-type {{ border-top: none; }}
    section.subject header {{ display: flex; flex-direction: column; gap: 2px; margin-bottom: 6px; }}
    section.subject h3 {{
      margin: 0; font-size: 12pt; color: #0c224d;
      text-transform: uppercase; letter-spacing: 0.04em;
    }}
    .meta {{ display: flex; gap: 14px; align-items: baseline; font-size: 10pt; flex-wrap: wrap; }}
    .meta strong {{ font-size: 13pt; color: #1a3f86; }}
    .cls {{ color: #555; }}
    .range {{ color: #777; font-size: 9.5pt; }}
    .coef {{ color: #555; margin-left: auto; }}
    .teachers {{ font-size: 9.5pt; color: #555; font-style: italic; }}
    p.comment {{ margin: 4px 0 6px; }}
    p.comment.muted {{ color: #888; }}
    .print-cta {{
      position: fixed; top: 14px; right: 14px;
      background: #1a3f86; color: white; border: none; border-radius: 6px;
      padding: 8px 14px; cursor: pointer; font-size: 11pt;
      box-shadow: 0 2px 8px rgba(0,0,0,0.12);
    }}
    @media print {{ .print-cta {{ display: none; }} }}
  </style>
</head>
<body>
  <button class='print-cta' onclick='window.print()'>Print / Save as PDF</button>
  <header class='page'>
    <h1>Bulletin — {esc(b.get('period_name'))}</h1>
    {''.join(head_lines)}
  </header>
  {("<section class='global'><h2>Appréciation générale</h2>" + globals_html + "</section>") if globals_html else ""}
  {''.join(rows)}
</body>
</html>
"""
