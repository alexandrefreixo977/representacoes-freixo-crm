"""Descarrega fotos dos sites oficiais dos fabricantes, põe-nas no formato uniforme e gera a migração.

Uso: python3 data/fetch_web_images.py lista.tsv public/img/<marca> <prefixo> <slug-fabricante> supabase/migrations/<data>_<marca>_imagens_web.sql "comentário"
lista.tsv: uma linha por artigo, "referência<TAB>url1<TAB>url2..." (tenta os endereços por ordem; o primeiro que for
uma imagem válida ganha). Endereços iguais são descarregados uma só vez.
Precisa de: pillow e acesso aos sites dos fabricantes.
"""
import concurrent.futures as cf
import hashlib
import io
import pathlib
import sys
import urllib.request

from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from normalize_images import normalize  # noqa: E402

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"


def fetch(url: str):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=40) as r:
            data = r.read()
        img = Image.open(io.BytesIO(data))
        img.load()
        if min(img.size) < 80:
            return None
        return data
    except Exception:  # noqa: BLE001
        return None


def main(listfile, out_dir, prefix, slug, migration, comment):
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    rows = [l.rstrip("\n").split("\t") for l in open(listfile, encoding="utf-8") if l.strip()]
    urls = sorted({u for r in rows for u in r[1:] if u})
    got = {}
    with cf.ThreadPoolExecutor(8) as ex:
        for u, data in zip(urls, ex.map(fetch, urls)):
            if data:
                name = f"{prefix}-{hashlib.sha1(u.encode()).hexdigest()[:10]}.jpg"
                p = out / name
                if not p.exists():
                    Image.open(io.BytesIO(data)).convert("RGBA").convert("RGB").save(p, "JPEG", quality=90)
                    normalize(p)
                got[u] = f"/img/{out.name}/{name}"
    pairs = []
    for r in rows:
        for u in r[1:]:
            if u in got:
                pairs.append((r[0], got[u]))
                break
    miss = [r[0] for r in rows if r[0] not in {p[0] for p in pairs}]
    q = lambda s: "'" + s.replace("'", "''") + "'"  # noqa: E731
    with open(migration, "w", encoding="utf-8") as f:
        f.write(f"-- {comment} {len(pairs)} de {len(rows)} artigos. Gerado por data/fetch_web_images.py.\n")
        if pairs:
            f.write("update public.b2b_products p set image_url = v.url, updated_at = now()\nfrom (values\n")
            f.write(",\n".join(f"({q(a)}, {q(b)})" for a, b in pairs))
            f.write(f"\n) as v(ref, url), public.b2b_manufacturers m\nwhere m.slug = {q(slug)} and p.manufacturer_id = m.id and p.reference = v.ref\n"
                    "  and coalesce(p.image_url, '') !~* '\\.(jpe?g|png|webp)(\\?|$)';\n")
    print(f"{len(pairs)}/{len(rows)} com foto; sem foto: {len(miss)}")
    if miss:
        falta = pathlib.Path(__file__).parent / "fotos-em-falta" / (pathlib.Path(migration).stem + ".txt")
        falta.parent.mkdir(exist_ok=True)
        falta.write_text("\n".join(miss), encoding="utf-8")


if __name__ == "__main__":
    main(*sys.argv[1:7])
