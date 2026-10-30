"""Lê a tarifa PDF da Röntgen (serras de fita e de máquina alternativa) e devolve a lista de artigos.

Uso (teste): python3 data/parse_rontgen.py "RONTGEN Tarifa 2025.pdf"
A tarifa não tem referências: cada artigo é série + largura x espessura + dentes por polegada (+ forma do dente),
com preço por metro e preço da soldadura de cada fita. As serras de máquina alternativa e de mão têm preço por unidade.
"""
import re
import sys

import fitz

SIZE = re.compile(r"^(\d+)\s*x\s*(\d+,\d+)$")
TPI = re.compile(r"^\d+(,\d+)?(/\d+(,\d+)?)?$")
EUR = re.compile(r"(\d+,\d+)\s*€(/m)?")


def num(s: str) -> float:
    return float(s.replace(".", "").replace(",", "."))


def lines_of(page):
    out = []
    for blk in page.get_text("dict")["blocks"]:
        for ln in blk.get("lines", []):
            t = "".join(s["text"] for s in ln["spans"]).strip()
            if t:
                out.append((fitz.Rect(ln["bbox"]), t, max(s["size"] for s in ln["spans"])))
    return out


def band_saws(doc):
    items = []
    for pn in range(2, 9):
        page = doc[pn]
        lines = lines_of(page)
        words = page.get_text("words")
        squares = [d["rect"] for d in page.get_drawings() if 2 < d["rect"].width < 7 and 2 < d["rect"].height < 7]
        titles = sorted((r.y0, t.replace("RÖNTGEN", "").strip()) for r, t, s in lines if t.startswith("RÖNTGEN") and s >= 12)
        rows = [(r, t) for r, t, s in lines if SIZE.match(t) and r.x0 < 100]
        rows.sort(key=lambda it: it[0].y0)
        for ti, (ty, series) in enumerate(titles):
            ny = titles[ti + 1][0] if ti + 1 < len(titles) else 1e9
            trows = [(r, t) for r, t in rows if ty < r.y0 < ny]
            if not trows:
                continue
            top = trows[0][0].y0
            row_ys = [(r.y0 + r.y1) / 2 for r, _ in trows]
            # cabeçalhos com os dentes por polegada: pode haver mais do que uma tabela por série (variável e fixo)
            head = [w for w in words if ty < w[1] < ny and w[0] > 165 and all(abs((w[1] + w[3]) / 2 - y) > 4 for y in row_ys)]
            head.sort(key=lambda w: (round(w[1]), w[0]))
            tokens = []
            for w in head:
                txt = w[4]
                if txt.startswith("/") and tokens and abs(tokens[-1][1] - w[1]) < 3:
                    tokens[-1] = (tokens[-1][0], tokens[-1][1], w[2], tokens[-1][3] + txt)
                elif TPI.match(txt):
                    tokens.append((w[0], w[1], w[2], txt))
            header_lines = {}
            for t in tokens:
                key = next((k for k in header_lines if abs(k - t[1]) < 4), t[1])
                header_lines.setdefault(key, []).append(t)
            header_lines = {k: v for k, v in header_lines.items() if len(v) >= 2 or len(trows) and v}
            hdr = " ".join(w[4] for w in words if ty < w[1] < top - 2)
            per_metre_col = "METRO" in hdr
            grit = "GRIT" in series
            for r, size in trows:
                m = SIZE.match(size)
                spec = f"{m.group(1)} x {m.group(2)}"
                cy = (r.y0 + r.y1) / 2
                rw = [w for w in words if abs((w[1] + w[3]) / 2 - cy) < 4]
                text = " ".join(w[4] for w in sorted(rw, key=lambda w: w[0]))
                euros = [(w, ) for w in rw]
                prices = [(mm.group(1), bool(mm.group(2))) for mm in EUR.finditer(text)]
                fixed = [num(p) for p, per_m in prices if not per_m]
                cells = [w for w in rw if w[0] > 165]

                above = [k for k in header_lines if k < r.y0]
                cols = header_lines[max(above)] if above else []

                def col_of(x):
                    return min(cols, key=lambda c: abs((c[0] + c[2]) / 2 - x))[3] if cols else ""

                if grit:
                    pitch = next((w[4] for w in rw if w[0] > 165 and re.fullmatch(r"\d+", w[4])), "")
                    items.append(dict(series=series, size=spec, tpi=("passo " + pitch + " mm") if pitch else "", form="",
                                      per_metre=fixed[0], weld=fixed[1]))
                    continue
                if per_metre_col:
                    pm, weld = fixed[0], fixed[1]
                    marks = [(w[4], (w[0] + w[2]) / 2) for w in cells if w[4] in ("N", "H", "N/H", "H/N")]
                    marks += [("", (s.x0 + s.x1) / 2) for s in squares if abs((s.y0 + s.y1) / 2 - cy) < 4 and s.x0 > 165]
                    for mk, x in marks:
                        forms = [f for f in mk.split("/") if f] or [""]
                        for f in forms:
                            items.append(dict(series=series, size=spec, tpi=col_of(x), form=f, per_metre=pm, weld=weld))
                else:
                    weld = fixed[0]
                    # células "117,60 €/m": juntar palavras "117,60" "€/m"
                    for i, w in enumerate(sorted(cells, key=lambda w: w[0])):
                        if re.fullmatch(r"\d+,\d+", w[4]):
                            items.append(dict(series=series, size=spec, tpi=col_of((w[0] + w[2]) / 2), form="",
                                              per_metre=num(w[4]), weld=weld))
    return items


def hand_saws(doc):
    page = doc[9]
    lines = lines_of(page)
    items, section, name = [], "", ""
    rows = []
    for r, t, s in sorted(lines, key=lambda it: (round(it[0].y0), it[0].x0)):
        if t in ("SIERRAS DE MANO", "SIERRAS DE MÁQUINA ALTERNATIVA"):
            section = t
        elif t in ("BI-ALFA", "MOLY", "MOLY 7"):
            name = t
        elif re.match(r"^\d+ x \d+ x \d+,\d+$", t):
            rows.append([r, section, name, t])
    words = page.get_text("words")
    for r, section, name, dim in rows:
        cy = (r.y0 + r.y1) / 2
        rest = " ".join(w[4] for w in sorted(words, key=lambda w: w[0]) if abs((w[1] + w[3]) / 2 - cy) < 4 and w[0] > r.x1 + 5)
        price = EUR.search(rest)
        teeth = re.findall(r"(\d+)z", rest.split("Progresivo")[0]) if "Progresivo" not in rest else ["32/18"]
        kind = "Serra de mão" if "MANO" in section else "Serra de máquina alternativa"
        for z in teeth:
            items.append(dict(series=name, kind=kind, dim=dim, teeth=z, price=num(price.group(1))))
    return items


if __name__ == "__main__":
    d = fitz.open(sys.argv[1])
    b = band_saws(d)
    h = hand_saws(d)
    import collections
    print(len(b), collections.Counter(i["series"] for i in b))
    for i in b[:6] + b[-4:]:
        print(i)
    print(len(h))
    for i in h[:5] + h[-3:]:
        print(i)
