"""Gera a migração SQL do catálogo VESIN a partir da transcrição da tarifa (data/vesin/tarifa_2026.txt).

Uso: python3 data/build_vesin.py data/vesin/tarifa_2026.txt supabase/migrations/<data>_vesin_catalogo.sql

A tarifa VESIN vem num PDF digitalizado (só imagens, sem texto), por isso foi transcrita à mão para o .txt.
Regras:
- Preço de tabela = coluna TARIFA (pedido até 400 € netos). A coluna NETO (pedido acima de 401 €) não entra.
- Quando o preço muda com o tamanho (ex. 48 a 66 / 68 y 70), cada faixa é um artigo: "3001-AF (48-66)".
- "REF {A,B}" = um artigo por cor ("REF A", "REF B"); "REF1,REF2" = várias referências com o mesmo preço.
- Faixa "Única" = artigo sem tamanho. As outras pedem o tamanho (vestuário).
- A primeira linha de cada referência ganha: as seguintes com a mesma referência são ignoradas.
"""
import collections
import re
import sys

PHRASES = [
    ("Pantalones", "Calças"), ("Pantalón", "Calças"), ("Cazadora", "Blusão"), ("Chaqueta", "Casaco"),
    ("Buzos", "Fatos-macaco"), ("Buzo", "Fato-macaco"), ("Bermudas", "Bermudas"), ("Bermuda", "Bermuda"),
    ("Camiseta", "T-shirt"), ("Camisola pijama", "Túnica pijama"), ("Camisa", "Camisa"), ("Polo", "Polo"),
    ("Parka", "Parka"), ("Chaleco", "Colete"), ("Forro polar", "Polar"), ("Jersey", "Camisola"),
    ("Sudadera", "Sweatshirt"), ("Casaca", "Túnica"), ("Bata", "Bata"), ("Delantal", "Avental"),
    ("Gorro", "Barrete"), ("Cofia", "Touca"), ("Peto", "Jardineiras"), ("Pico cocinero", "Lenço de cozinheiro"),
    ("multibolsillos", "multibolsos"), ("multicremalleras", "multifechos"), ("con cremallera", "com fecho"),
    ("cremallera", "fecho"), ("tapeta", "pala"), ("velcro", "velcro"), ("con goma", "com elástico"),
    ("goma en toda la cintura", "elástico em toda a cintura"), ("goma en tirantes", "elástico nas alças"),
    ("acolchado", "acolchoado"), ("acolchada", "acolchoado"), ("manga corta", "manga curta"), ("manga larga", "manga comprida"),
    ("m/corta", "manga curta"), ("dos bolsillos", "dois bolsos"), ("bolsillos", "bolsos"), ("bolsillo", "bolso"),
    ("transpirable", "respirável"), ("cinta continua", "fita contínua"), ("cintas segmentadas", "fitas segmentadas"),
    ("cinta segmentada", "fita segmentada"), ("bandas segmentadas", "bandas segmentadas"), ("cinta reflectante", "fita refletora"),
    ("cinta regulable", "fita regulável"), ("vivos flúor", "vivos flúor"), ("vivos reflectantes", "vivos refletores"),
    ("triple costura", "costura tripla"), ("pespuntes color naranja", "pespontos cor de laranja"),
    ("pespuntes al tono", "pespontos da mesma cor"), ("con refuerzos", "com reforços"), ("refuerzos", "reforços"),
    ("abierto entero", "aberto inteiro"), ("abierto", "aberto"), ("abierta", "aberto"), ("cuello redondo", "gola redonda"),
    ("cuello pico", "gola em bico"), ("cuello solapa", "gola com lapela"), ("cuello", "gola"), ("cierre de clips", "fecho de molas"),
    ("con clips", "com molas"), ("cierre de velcro", "fecho de velcro"), ("broches ocultos", "molas ocultas"),
    ("para frío", "para o frio"), ("de lluvia", "de chuva"), ("soft shell", "softshell"), ("bomber", "bomber"),
    ("triple uso - chaqueta - chaleco", "3 em 1 (casaco e colete)"), ("clásica", "clássica"), ("náutica", "náutica"),
    ("mangas desmontables", "mangas amovíveis"), ("pilot", "piloto"), ("forro polar", "forro polar"),
    ("forro de franela", "forro de flanela"), ("de pana", "de bombazina"), ("piqué", "piqué"),
    ("con peto de PVC", "com peito em PVC"), ("con peto ajustable", "com peito ajustável"), ("con peto", "com peito"),
    ("sin peto", "sem peito"), ("con visera", "com pala"), ("militar", "militar"), ("con rejilla", "com rede"),
    ("tipo militar", "tipo militar"), ("champiñón", "cogumelo"), ("bandana", "bandana"), ("medio / alto", "médio / alto"),
    ("de señora", "de senhora"), ("señora entallada", "senhora cintada"), ("señora", "senhora"), ("de rayas", "às riscas"),
    ("rayas", "às riscas"), ("colores lisos", "cores lisas"), ("caballero", "homem"), ("con botones", "com botões"),
    ("cruzada", "traçado"), ("femenina", "senhora"), ("unisex", "unissexo"), ("y manga corta", "e manga curta"),
    ("espalda transpirable", "costas respiráveis"), ("cocinera", "cozinheira"), ("cocinero", "cozinheiro"),
    ("deportivo", "desportivo"), ("técnico", "técnico"), ("hebillas", "fivelas"), ("hebilla", "fivela"),
    ("chino", "chino"), ("stretch", "stretch"), ("pijama", "pijama"), ("tricolor", "tricolor"), ("bicolor", "bicolor"),
    ("sport", "sport"), ("azul jeans", "azul ganga"), ("azul oscuro", "azul escuro"), ("pata de gallo", "pied-de-poule"),
    ("100% algodón", "100% algodão"), ("poliéster/algodón", "poliéster/algodão"),
    ("marino", "azul-marinho"), ("rojo", "vermelho"), ("gris", "cinzento"), ("negro", "preto"),
    ("beige", "bege"), ("azul medio", "azul médio"), ("y verde", "e verde"),
    (" con ", " com "), (" y ", " e "), (" de ", " de "), (" en ", " em "), (" para ", " para "),
]

COLOURS = {
    "AZULINA": "azulina", "GRIS": "cinzento", "MARINO": "azul-marinho", "VERDE": "verde", "BLANCO": "branco",
    "NEGRO": "preto", "BEIGE": "bege", "CELESTE": "azul-celeste", "ROJO": "vermelho", "AMARILLO": "amarelo",
    "AZUL": "azul", "NARANJA": "laranja", "CAZA": "caça", "MEDIO": "médio", "CUADROS": "xadrez",
}


def pt(text: str) -> str:
    t = f" {text} "
    for es, p in sorted(PHRASES, key=lambda it: -len(it[0])):
        t = re.sub(rf"(?<![\wáéíóúñ]){re.escape(es.strip())}(?![\wáéíóúñ])" if es.strip() == es else re.escape(es),
                   p.strip() if es.strip() == es else p, t)
    t = " ".join(t.split())
    return t[:1].upper() + t[1:]


def colour_pt(c: str) -> str:
    return "/".join(" ".join(COLOURS.get(w, w.lower()) for w in part.split()) for part in c.split("/"))


def size_key(rng: str) -> str:
    return re.sub(r"\s+(a|y)\s+", "-", rng.strip(), flags=re.I).replace(" ", "")


def q(v) -> str:
    return "null" if v in (None, "") else "'" + str(v).replace("'", "''") + "'"


def parse(path: str):
    items, seen, family = [], set(), "Outros"
    for raw in open(path, encoding="utf-8"):
        line = raw.strip()
        if not line or line.startswith("# "):
            continue
        if line.startswith("## "):
            family = line[3:].strip()
            continue
        refs, name, ranges = [p.strip() for p in line.split("|")]
        expanded = []
        for ref in re.split(r",(?![^{]*\})", refs):
            m = re.fullmatch(r"(.+?)\s*\{(.+)\}", ref.strip())
            if m:
                expanded += [(f"{m.group(1)} {c.strip()}", c.strip()) for c in m.group(2).split(",")]
            else:
                expanded.append((ref.strip(), None))
        bands = []
        for part in ranges.split(";"):
            rng, prices = part.split("=")
            tarifa, _neto = prices.split("/")
            bands.append((rng.strip(), float(tarifa.replace(",", "."))))
        for ref, colour in expanded:
            # A cor só aparece na referência quando a tarifa a separa ({...}) ou escreve à frente do código.
            if colour is None:
                m = re.fullmatch(r"(.+?)\s+([A-Z][A-Z/ ]+)", ref)
                if m and all(w in COLOURS for w in re.split(r"[/ ]", m.group(2))):
                    colour = m.group(2)
            for rng, price in bands:
                single = len(bands) == 1
                reference = ref if single else f"{ref} ({size_key(rng)})"
                if reference in seen:
                    continue
                seen.add(reference)
                unica = rng.lower() == "única"
                designation = pt(name)
                if colour:
                    designation += f" · {colour_pt(colour)}"
                if not unica:
                    designation += f" · Tam. {rng.replace(' y ', ' e ')}"
                description = (f"{name}." + (f" Cor: {colour_pt(colour)}." if colour else "")
                               + ("" if unica else f" Tamanhos: {rng.replace(' y ', ' e ')}."))
                items.append((reference, designation[:200], description, family,
                               None if unica else "vestuario", price))
    return items


def main(src: str, out_sql: str) -> None:
    items = parse(src)
    values = ",\n".join(f"({q(r)},{q(d)},{q(x)},{q(f)},{q(s)},{p})" for r, d, x, f, s, p in items)
    with open(out_sql, "w", encoding="utf-8") as fh:
        fh.write(f"""-- Catálogo VESIN (tarifa 2023, edição 2026, {len(items)} artigos). Gerado por data/build_vesin.py — não editar à mão.
-- Preço de tabela = coluna TARIFA (pedidos até 400 € netos). Cada faixa de tamanhos com preço próprio é um artigo.

insert into public.b2b_manufacturers (name, slug, orders_email, sort, active)
values ('VESIN', 'vesin', 'rosamari.ventas@vesin.com', 105, true)
on conflict (slug) do update set orders_email = excluded.orders_email, active = true;

create temp table vesin_import (reference text, designation text, description text, family text,
  size_type text, list_price numeric);

insert into vesin_import values
{values};

do $$
declare m uuid := (select id from public.b2b_manufacturers where slug = 'vesin');
begin
  insert into public.b2b_families (manufacturer_id, name)
  select distinct m, family from vesin_import
  on conflict (manufacturer_id, name) do nothing;

  insert into public.b2b_products (manufacturer_id, family_id, reference, designation, description,
    sales_unit, pack_qty, moq, size_type, is_new, active, updated_at)
  select m, fam.id, a.reference, a.designation, a.description, 'un', 1, 1, a.size_type, false, true, now()
  from vesin_import a join public.b2b_families fam on fam.manufacturer_id = m and fam.name = a.family
  on conflict (manufacturer_id, reference) do update set
    designation = excluded.designation, description = excluded.description,
    size_type = excluded.size_type, family_id = excluded.family_id, active = true, updated_at = now();

  insert into public.b2b_prices (product_id, list_price)
  select p.id, a.list_price from vesin_import a
  join public.b2b_products p on p.manufacturer_id = m and p.reference = a.reference
  on conflict (product_id) do update set list_price = excluded.list_price, updated_at = now();
end $$;

drop table vesin_import;
""")
    print(f"{len(items)} artigos -> {out_sql}")
    print(collections.Counter(i[3] for i in items).most_common())


if __name__ == "__main__":
    main(*sys.argv[1:3])
