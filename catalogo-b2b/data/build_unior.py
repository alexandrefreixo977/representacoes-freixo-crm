"""Gera as migrações do catálogo UNIOR Hand Tools e da campanha de preços netos para distribuidores.

Uso (o 5.º ficheiro, opcional, corrige os artigos já carregados): python3 data/build_unior.py "TARIFA UNIOR 2026-27 V3.xlsx" "PRECIOS NETOS PROMOCION ESPECIAL DISTRIBUIDORES 2026-27.xlsx" \
       supabase/migrations/<data>_unior_catalogo.sql supabase/migrations/<data>_campanha_unior_2026.sql [<data>_unior_designacoes.sql]

Tarifa: Código/SKU, DESCRIPCION, P.V.P 2026, …, Codigo EAN, FAMILIA, Categoria, Categoria II, peso e medidas,
embalagens RP2/IP, Link Ficha Técnica, Link Fotografia Artículo. Preço de tabela = P.V.P 2026.
Campanha: as mesmas colunas com NETO PROMOCION DISTRIBUIDOR. Válida até 26/02/2027, só para revendedores com conta.
"""
import re
import sys

import openpyxl

SLUG = "unior"
CAMPAIGN_ID = "b1d0a1f0-2026-4f27-9e00-0000000b2027"
ENDS_ON = "2027-02-26"

# Categoria UNIOR (sem o número) -> família na loja
FAMILIES = {
    "Llaves": "Chaves", "Vasos y Accesorios": "Chaves de caixa e acessórios", "Alicates": "Alicates",
    "Herramienta Aislada VDE": "Ferramenta isolada VDE", "Fontanería": "Canalização", "Tijeras": "Tesouras e corta-cabos",
    "Destornilladores": "Chaves de fendas", "Extractores": "Extratores", "Martillos, punteros y Cortafríos": "Martelos, punções e escopros",
    "Mobiliario": "Mobiliário de oficina", "Mobiliario NEGRO": "Mobiliário de oficina (preto)", "Mobiliario Negro": "Mobiliário de oficina (preto)",
    "Neumática": "Ferramenta pneumática", "Medición": "Medição e binário", "Electrónica": "Eletrónica", "Automoción": "Automóvel",
    "Herramienta para Bicicleta": "Ferramenta para bicicleta", "Varios": "Diversos", "Juegos": "Jogos de ferramentas",
    "Marketing": "Expositores e marketing", "Material Publicitario": "Expositores e marketing",
    "Herramientas para Motos": "Ferramenta para motos", "Piezas de repuesto": "Peças de substituição", "Antichispa": "Ferramenta antichispa",
}


# Peças de substituição: a tarifa traz a designação em esloveno, com "|" a separar campos. Tradução das palavras usadas.
SLOVENE = [
    ("Garnitura nasadnih ključev", "Jogo de chaves de caixa"), ("v kovinski kaseti", "em caixa metálica"), ("dolgih", "longas"),
    ("v SOS vložku", "em módulo SOS"), ("Klešče za vijake", "Alicate para parafusos"), ("Pretični vzvod za moment ključ", "Alavanca de catraca para chave dinamométrica"),
    ("Pastorek za moment ključ", "Pinhão para chave dinamométrica"), ("Vijak za moment ključ", "Parafuso para chave dinamométrica"),
    ("Vzmet za moment ključ", "Mola para chave dinamométrica"), ("Pokrov za moment ključ", "Tampa para chave dinamométrica"),
    ("moment ključ", "chave dinamométrica"), ("GRT. REZERVNIH DELOV", "Jogo de peças de substituição"),
    ("GRT.REZERVNIH DELOV", "Jogo de peças de substituição"), ("GRT.REZERNIH DELOV", "Jogo de peças de substituição"),
    ("VZMETNA PODLOŽKA", "Anilha de mola"), ("WAVE PODLOŽKA", "Anilha ondulada"), ("PODLOŽKA", "Anilha"),
    ("Vzmetni zatič", "Cavilha de mola"), ("Zadnja zaščitna plošča", "Placa de proteção traseira"),
    ("Sprednja zaščitna plošča", "Placa de proteção dianteira"), ("Ozobljeni obroč", "Anel dentado"), ("Igličasti ležaj", "Rolamento de agulhas"),
    ("Ohišje raglje", "Carcaça da catraca"), ("Ročična gred", "Cambota"), ("Plošča vmesnega zobnika", "Placa da engrenagem intermédia"),
    ("Pogonska puša", "Casquilho de acionamento"), ("Guma ročaja", "Borracha do punho"), ("O-OBROČ DRŽALA", "O-ring do suporte"),
    ("DRŽALO NASADNEGA KLJUČA", "Suporte da chave de caixa"), ("Stranski ročaj", "Punho lateral"), ("MATICA OHIŠJA", "Porca da carcaça"),
    ("KROGLIČNI LEŽAJ", "Rolamento de esferas"), ("POŠEVNI ZOBNIK ZA", "Engrenagem helicoidal para"), ("PERO ZA", "Mola para"),
    ("ZAMENLJIVI DELI", "Peças substituíveis"), ("Zamenljivi deli", "Peças substituíveis"), ("ROTOR ZA", "Rotor para"),
    ("TORBICA", "Bolsa"), ("Ležišče za kovico", "Assento para rebite"), ("Ključ surovec", "Chave em bruto"),
    ("Steber deljiv za pano", "Coluna divisível para painel"), ("Rubber ring", "Anel de borracha"), ("O-OBROČ", "O-ring"),
    ("Držalo", "Suporte"), ("DRŽALO", "Suporte"), ("Ohišje", "Carcaça"), ("NAKOVALO", "Bigorna"), ("PUŠA", "Casquilho"), ("Puša", "Casquilho"),
    ("ZATIČ", "Cavilha"), ("Zatič", "Cavilha"), ("Obroč", "Anel"), ("KLJUČ", "Chave"), ("Ključ", "Chave"),
    ("set", "jogo"), ("kosov", "peças"), ("levi", "esquerdo"), ("desni", "direito"), ("ZA", "para"), ("za", "para"),
]

# Peças das ferramentas pneumáticas: designação em inglês. Termos mais usados (frases primeiro).
ENGLISH = [
    ("o-ring", "O-ring"), ("valve pin", "cavilha da válvula"), ("rotor spacer", "espaçador do rotor"), ("clamp nut", "porca de aperto"),
    ("rubber cap", "tampa de borracha"), ("ratchet pawl", "lingueta da catraca"),
    ("reverse valve knob", "botão da válvula de inversão"), ("case valve", "válvula da caixa"), ("set screw", "perno roscado"),
    ("rotor blades", "palhetas do rotor"), ("blades", "palhetas"), ("plastic body", "corpo plástico"), ("throttle", "gatilho"), ("lnside", "interior"), ("inside", "interior"), ("or", "ou"), ("ball bearing", "rolamento de esferas"), ("needle bearing", "rolamento de agulhas"), ("throttle valve", "válvula do gatilho"),
    ("reverse valve", "válvula de inversão"), ("air inlet", "entrada de ar"), ("retaining ring", "anel de retenção"), ("rubber ring", "anel de borracha"),
    ("spring pin", "cavilha elástica"), ("end plate", "placa de topo"), ("front end plate", "placa de topo dianteira"), ("rear end plate", "placa de topo traseira"),
    ("housing cap", "tampa da carcaça"), ("cylinder pin", "cavilha do cilindro"), ("cilinder pin", "cavilha do cilindro"), ("hammer case", "caixa do martelo"),
    ("hammer pin", "cavilha do martelo"), ("hammer frame", "estrutura do martelo"), ("hammer", "martelo"), ("idler gear", "engrenagem intermédia"),
    ("planet gear", "engrenagem planetária"), ("thrust washer", "anilha de encosto"), ("oil seal", "retentor de óleo"), ("assembly", "conjunto"),
    ("assem.", "conj."), ("assemb.", "conj."), ("assem", "conj."), ("valve", "válvula"), ("spring", "mola"), ("pin", "cavilha"), ("ball", "esfera"),
    ("bearing", "rolamento"), ("rotor", "rotor"), ("screw", "parafuso"), ("plate", "placa"), ("bushing", "casquilho"), ("washer", "anilha"),
    ("gasket", "junta"), ("housing", "carcaça"), ("cylinder", "cilindro"), ("anvil", "bigorna"), ("retainer", "retentor"), ("gear", "engrenagem"),
    ("trigger", "gatilho"), ("motor", "motor"), ("blade", "palheta"), ("case", "caixa"), ("lock", "trinco"), ("ratchet", "catraca"), ("lever", "alavanca"),
    ("shaft", "veio"), ("knob", "botão"), ("button", "botão"), ("muffler", "silenciador"), ("nut", "porca"), ("cap", "tampa"), ("exhaust", "escape"),
    ("frame", "estrutura"), ("handle", "punho"), ("grip", "pega"), ("socket", "caixa"), ("regulator", "regulador"), ("deflector", "deflector"),
    ("spacer", "espaçador"), ("stem", "haste"), ("clamp", "braçadeira"), ("key", "chave"), ("seat", "assento"), ("kit", "kit"), ("plunger", "êmbolo"),
    ("spindle", "fuso"), ("dowel", "cavilha"), ("seal", "vedante"), ("diffuser", "difusor"), ("cage", "gaiola"), ("pawl", "lingueta"),
    ("nosepiece", "bocal"), ("jaw", "maxila"), ("front", "dianteiro"), ("rear", "traseiro"), ("with", "com"), ("incl.", "incl."), ("for", "para"),
    ("pcs/set", "un./jogo"), ("pcs", "un."), ("ring", "anel"), ("air", "ar"), ("steel", "aço"), ("rubber", "borracha"),
]


def translate_en(text: str) -> str:
    text = re.sub(r"(\d+)\s*pcs\b", r"\1 un.", text, flags=re.I)
    for en, ptx in ENGLISH:
        def rep(m, ptx=ptx):
            return ptx[:1].upper() + ptx[1:] if m.group(0)[:1].isupper() else ptx
        text = re.sub(rf"(?<![\wÀ-ž-]){re.escape(en)}(?![\wÀ-ž-])", rep, text, flags=re.I)
    return text


def clean_designation(ref: str, desc: str) -> str:
    """Tira os "|" e os códigos repetidos, traduz o esloveno e arruma "modelo-nome-medida"."""
    key = lambda t: re.sub(r"[^0-9a-z]", "", t.lower())
    parts = []
    desc = re.sub(r"(?<=[A-Za-z])\|(?=[A-Za-z])|(?<=\d)\|(?=\d)", "", str(desc))  # "i|n" -> "in" (gralha)
    desc = re.sub(r"(?<=\d)(?=[A-Z][a-z]|O-[Rr]ing)", " ", desc)  # "1531.9Retainer" -> "1531.9 Retainer"
    for part in desc.split("|"):
        part = " ".join(part.split()).strip(" -")
        if not part or key(part) == key(ref) or part in parts:
            continue
        # Só códigos (ex. "1510SP2 1510 SP2", "1514.19 1514.19"): não é designação.
        if not re.search(r"[A-Za-zÀ-ž]{3,}", re.sub(r"\b[0-9][0-9A-Za-z./*]*\b|\bSP\b|\bvl[0-9A-Za-z/]+", "", part)):
            continue
        parts.append(part)
    text = " · ".join(parts)
    for sl, ptx in SLOVENE:
        text = re.sub(rf"(?<![\wÀ-ž]){re.escape(sl)}(?![\wÀ-ž])", ptx, text)
    if not parts:
        return f"Peça de substituição {ref}"
    # Peças: "1532.53 Guma ročaja…" -> "Borracha do punho… (peça 1532.53)"
    m = re.match(r"^(\d{3,4}[A-Z]?\.\d+[A-Z]?\d*)\s+(?=[A-Za-zÀ-ž])(.*)$", text)
    if m and "-" not in m.group(1):
        text = f"{translate_en(m.group(2))} (peça {m.group(1)})"
    bits = [x.strip() for x in text.strip(" -").split("-", 2)]
    code = len(bits) >= 2 and re.fullmatch(r"[0-9A-Za-z][\w./*,]*( \d\w*)?", bits[0]) and re.search(r"\d", bits[0])
    name_ok = len(bits) >= 2 and (bits[1][:1].isalpha() or " " in bits[1])
    if code and name_ok and len(bits) == 3 and bits[2]:
        text = f"{bits[1]} · {bits[2]} · mod. {bits[0]}"  # "110/1-Llaves fija-6 x 7" -> "Llaves fija · 6 x 7 · mod. 110/1"
    elif code and name_ok and len(bits) == 2:
        text = f"{bits[1]} · mod. {bits[0]}"  # "990TB2-Banco de trabajo…" -> "Banco de trabajo… · mod. 990TB2"
    return text[:1].upper() + text[1:]


def family(cat) -> str:
    name = re.sub(r"^\s*\d+\.\s*", "", str(cat or "")).strip()
    return FAMILIES.get(name, name or "Outros")


def img_of(r):
    v = str(r.get("Link Fotografia Artículo") or "").strip()
    return v if v.startswith("http") else None


def sheet_of(r):
    v = str(r.get("Link Ficha Técnica") or "").strip()
    return v if v.startswith("http") else None


def q(v) -> str:
    return "null" if v in (None, "") else "'" + str(v).replace("'", "''") + "'"


def num(v) -> str:
    return str(v).replace(".", ",") if v not in (None, "") else ""


def rows_of(path):
    ws = openpyxl.load_workbook(path, read_only=True).worksheets[0]
    head = None
    for r in ws.iter_rows(values_only=True):
        if head is None:
            if r and r[0] == "Código/SKU":
                head = [str(h or "").strip() for h in r]
            continue
        if r[0] is None:
            continue
        yield dict(zip(head, r))


def main(tarifa, promo, out_cat, out_camp, out_fix=None):
    seen, values, fixes = set(), [], []
    for r in rows_of(tarifa):
        ref = str(r["Código/SKU"]).strip()
        price = r["P.V.P 2026"]
        if ref in seen or not isinstance(price, (int, float)):
            continue
        seen.add(ref)
        desc = clean_designation(ref, r["DESCRIPCION"])
        details = []
        if r.get("Categoria II") and r["Categoria II"] != 0:
            details.append(f"Linha: {re.sub(r'^[0-9.]+ *', '', str(r['Categoria II'])).strip()}")
        dims = [num(r.get(k)) for k in ("Longitud del producto", "Ancho del producto", "Altura del producto")]
        if all(dims):
            details.append(f"Dimensões: {' x '.join(dims)} mm")
        if r.get("Peso del producto (g)"):
            details.append(f"Peso: {num(r['Peso del producto (g)'])} g")
        if r.get("HASTA FIN DE EXISTENCIA"):
            details.append("Até fim de existências")
        details.append("Tarifa UNIOR 2026-27")
        values.append(f"({q(ref)},{q(r.get('Codigo EAN'))},{q(desc[:200])},{q('. '.join(details))},"
                      f"{q(img_of(r))},{q(sheet_of(r))},{q(family(r.get('Categoria')))},{round(float(price), 2)})")
        fixes.append(f"({q(ref)},{q(desc[:200])},{q('. '.join(details))},{q(img_of(r))},{q(sheet_of(r))})")

    with open(out_cat, "w", encoding="utf-8") as fh:
        fh.write(f"""-- Catálogo UNIOR Hand Tools (tarifa 2026-27, em vigor de 15/07/2026 a 26/02/2027, {len(values)} artigos).
-- Gerado por data/build_unior.py — não editar à mão. Preço de tabela = P.V.P 2026. Encomendas para unior@unior.es.

insert into public.b2b_manufacturers (name, slug, orders_email, sort, active)
values ('UNIOR', '{SLUG}', 'unior@unior.es', 260, true)
on conflict (slug) do update set orders_email = excluded.orders_email, active = true;

create temp table unior_import (reference text, ean text, designation text, description text, image_url text,
  tech_sheet_url text, family text, list_price numeric);

insert into unior_import values
{",\n".join(values)};

do $$
declare m uuid := (select id from public.b2b_manufacturers where slug = '{SLUG}');
begin
  insert into public.b2b_families (manufacturer_id, name)
  select distinct m, family from unior_import
  on conflict (manufacturer_id, name) do nothing;

  insert into public.b2b_products (manufacturer_id, family_id, reference, ean, designation, description, image_url,
    tech_sheet_url, sales_unit, pack_qty, moq, is_new, active, updated_at)
  select m, fam.id, a.reference, a.ean, a.designation, a.description, a.image_url, a.tech_sheet_url, 'un', 1, 1, false, true, now()
  from unior_import a join public.b2b_families fam on fam.manufacturer_id = m and fam.name = a.family
  on conflict (manufacturer_id, reference) do update set
    ean = excluded.ean, designation = excluded.designation, description = excluded.description,
    image_url = coalesce(excluded.image_url, public.b2b_products.image_url), tech_sheet_url = excluded.tech_sheet_url,
    family_id = excluded.family_id, active = true, updated_at = now();

  insert into public.b2b_prices (product_id, list_price)
  select p.id, a.list_price from unior_import a
  join public.b2b_products p on p.manufacturer_id = m and p.reference = a.reference
  on conflict (product_id) do update set list_price = excluded.list_price, updated_at = now();
end $$;

drop table unior_import;
""")
    print(len(values), "artigos ->", out_cat)

    if out_fix:  # correção das designações dos artigos já carregados (a migração do catálogo não volta a correr)
        with open(out_fix, "w", encoding="utf-8") as fh:
            fh.write(f"""-- UNIOR: designações limpas (sem "|" nem códigos repetidos, peças traduzidas do esloveno/inglês),
-- ficha técnica no campo próprio e fotos que faltavam. Gerado por data/build_unior.py — não editar à mão.
-- Só mexe nos campos que vêm da tarifa; preços e artigos editados noutros campos ficam como estão.

create temp table unior_fix (reference text, designation text, description text, image_url text, tech_sheet_url text);

insert into unior_fix values
{",\n".join(fixes)};

update public.b2b_products p set designation = f.designation, description = f.description,
  image_url = coalesce(p.image_url, f.image_url), tech_sheet_url = coalesce(f.tech_sheet_url, p.tech_sheet_url), updated_at = now()
from unior_fix f, public.b2b_manufacturers m
where m.slug = '{SLUG}' and p.manufacturer_id = m.id and p.reference = f.reference;

drop table unior_fix;
""")
        print(len(fixes), "correções ->", out_fix)

    offer, done = [], set()
    for r in rows_of(promo):
        ref = str(r["Código/SKU"]).strip()
        net = r["NETO PROMOCION DISTRIBUIDOR"]
        if ref in done or not isinstance(net, (int, float)):
            continue
        if ref not in seen:
            raise SystemExit(f"Artigo da campanha fora da tarifa: {ref}")
        done.add(ref)
        offer.append(f"({q(ref)},{round(float(net), 2)})")

    with open(out_camp, "w", encoding="utf-8") as fh:
        fh.write(f"""-- Campanha UNIOR "Promoção especial distribuidores 2026-27" (preços netos, {len(offer)} artigos), válida até 26/02/2027.
-- Só para revendedores com conta (pedido do Alexandre, 31/10/2026). Gerado por data/build_unior.py — não editar à mão.

insert into public.b2b_campaigns (id, title, subtitle, badge, details, manufacturer_id, starts_on, ends_on, active, sort, members_only)
select {q(CAMPAIGN_ID)}, 'Promoção especial distribuidores 2026-27',
  'Preços netos em chaves, alicates, ferramenta isolada VDE, jogos, medição e mobiliário de oficina. Até 26 de fevereiro de 2027.',
  'Preço neto',
  'Preços netos por unidade para distribuidores, já aplicados no seu carrinho. Válidos até 26/02/2027.',
  m.id, '2026-10-31', {q(ENDS_ON)}, true, 20, true
from public.b2b_manufacturers m where m.slug = '{SLUG}'
on conflict (id) do update set title = excluded.title, subtitle = excluded.subtitle, badge = excluded.badge, details = excluded.details,
  starts_on = excluded.starts_on, ends_on = excluded.ends_on, members_only = true;

create temp table unior_offer (reference text, net_price numeric);
insert into unior_offer values
{",\n".join(offer)};

do $$
declare m uuid := (select id from public.b2b_manufacturers where slug = '{SLUG}');
begin
  delete from public.b2b_discount_rules where campaign_id = {q(CAMPAIGN_ID)};
  insert into public.b2b_discount_rules (client_id, manufacturer_id, product_id, discounts, special_net_price, active, valid_until, campaign_id)
  select null, m, p.id, '{{}}', o.net_price, true, {q(ENDS_ON)}, {q(CAMPAIGN_ID)}
  from unior_offer o join public.b2b_products p on p.manufacturer_id = m and p.reference = o.reference;

  if (select count(*) from public.b2b_discount_rules where campaign_id = {q(CAMPAIGN_ID)}) <> (select count(*) from unior_offer) then
    raise exception 'Campanha UNIOR: há artigos da oferta que não foram encontrados';
  end if;
end $$;

drop table unior_offer;
""")
    print(len(offer), "preços de campanha ->", out_camp)


if __name__ == "__main__":
    main(*sys.argv[1:6])
