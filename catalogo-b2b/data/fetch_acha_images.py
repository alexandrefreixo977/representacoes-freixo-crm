"""Descarrega as fotos da ACHA (que estão no site acha.com), põe-nas no formato uniforme e serve-as a partir da loja.

Uso: python3 data/fetch_acha_images.py supabase/migrations/<data>_acha_catalogo.sql public/img/acha \
       supabase/migrations/<data>_acha_imagens.sql
Precisa de: pillow e acesso à internet (corre no GitHub Actions: workflow "Catálogo B2B — fotos ACHA").

As fotos ficam em public/img/acha com o mesmo nome do site e a migração troca o endereço acha.com pelo da loja.
Uma foto que não se consiga descarregar fica com o endereço antigo.
"""
import pathlib
import re
import sys
import time
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from normalize_images import normalize  # noqa: E402


def fetch(url: str, dest: pathlib.Path) -> bool:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (catalogo Representacoes Freixo)"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            if len(data) < 500:
                return False
            dest.write_bytes(data)
            normalize(dest)
            return True
        except Exception as e:  # noqa: BLE001
            print(f"  falhou ({attempt + 1}/3) {url}: {e}")
            time.sleep(2 * (attempt + 1))
    return False


def main(catalog_sql: str, out_dir: str, migration: str) -> None:
    urls = sorted(set(re.findall(r"https?://[^']*acha\.com/[^']+\.(?:jpe?g|png|webp)", open(catalog_sql, encoding="utf-8").read(), re.I)))
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    folder = out_dir.rstrip("/").split("public/", 1)[-1]
    done = {}
    for i, url in enumerate(urls, 1):
        name = re.sub(r"\.(png|webp|jpeg)$", ".jpg", url.rsplit("/", 1)[-1], flags=re.I)
        dest = out / name
        if dest.exists() or fetch(url, dest):
            done[url] = f"/{folder}/{name}"
        if i % 100 == 0:
            print(f"{i}/{len(urls)}")
    values = ",\n".join(f"('{u}', '{p}')" for u, p in sorted(done.items()))
    with open(migration, "w", encoding="utf-8") as fh:
        fh.write(f"""-- Fotos ACHA servidas pela loja, no formato uniforme (data/fetch_acha_images.py). {len(done)} de {len(urls)} fotos.
update public.b2b_products p set image_url = v.local, updated_at = now()
from (values
{values}
) as v(remote, local), public.b2b_manufacturers m
where m.slug = 'acha-herramientas' and p.manufacturer_id = m.id and p.image_url = v.remote;
""")
    print(f"{len(done)} de {len(urls)} fotos descarregadas")


if __name__ == "__main__":
    main(*sys.argv[1:4])
