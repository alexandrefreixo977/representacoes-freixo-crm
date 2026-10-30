import type { Campaign, Client, DiscountRule, Family, Manufacturer, Product } from "../types";

// Dados fictícios só para experimentar a app. Os nomes de fabricante são genéricos de propósito.

export const seedManufacturers: Manufacturer[] = [
  { id: "m-epi", name: "Proteção Pro", slug: "protecao-pro", sort: 110, ordersEmail: "encomendas@protecao-pro.example" },
  { id: "m-abr", name: "AbraTec", slug: "abratec", sort: 210, ordersEmail: "orders@abratec.example" },
  { id: "m-fer", name: "ToolMaster", slug: "toolmaster", sort: 220, ordersEmail: "pedidos@toolmaster.example" },
  { id: "m-con", name: "FixLine", slug: "fixline", sort: 230, ordersEmail: "sales@fixline.example" },
];

export const seedFamilies: Family[] = [
  { id: "f-luvas", manufacturerId: "m-epi", name: "Luvas" },
  { id: "f-calcado", manufacturerId: "m-epi", name: "Calçado de segurança" },
  { id: "f-resp", manufacturerId: "m-epi", name: "Proteção respiratória" },
  { id: "f-discos", manufacturerId: "m-abr", name: "Discos de corte" },
  { id: "f-lixas", manufacturerId: "m-abr", name: "Discos de lamelas" },
  { id: "f-manuais", manufacturerId: "m-fer", name: "Ferramenta manual" },
  { id: "f-medicao", manufacturerId: "m-fer", name: "Medição" },
  { id: "f-fix", manufacturerId: "m-con", name: "Fixação" },
  { id: "f-quim", manufacturerId: "m-con", name: "Químicos e sprays" },
];

type Seed = [string, string, string, string, number, string, number, boolean?];
// [família, referência, designação, descrição, preço tabela, unidade, unidades por caixa, novidade]
const rows: Seed[] = [
  ["f-luvas", "PP-NIT-08", "Luva nitrilo revestimento palma T8", "EN 388 4121X. Suporte em poliéster, boa destreza para montagem.", 1.85, "par", 12],
  ["f-luvas", "PP-NIT-09", "Luva nitrilo revestimento palma T9", "EN 388 4121X. Suporte em poliéster, boa destreza para montagem.", 1.85, "par", 12],
  ["f-luvas", "PP-CUT5-09", "Luva anticorte nível C T9", "EN 388 4X42C. Revestimento PU, toque ecrã.", 6.9, "par", 12, true],
  ["f-luvas", "PP-DESC-100", "Luva descartável nitrilo azul (cx 100)", "Sem pó, 0,10 mm, EN 374.", 7.5, "cx", 10],
  ["f-calcado", "PP-S3-41", "Sapato segurança S3 SRC N.º 41", "Biqueira composite, palmilha antiperfuração têxtil.", 48.0, "par", 1],
  ["f-calcado", "PP-S3-43", "Sapato segurança S3 SRC N.º 43", "Biqueira composite, palmilha antiperfuração têxtil.", 48.0, "par", 1],
  ["f-calcado", "PP-BOTA-42", "Bota segurança S3 HRO N.º 42", "Sola resistente a 300 ºC, ideal para soldadura.", 62.5, "par", 1, true],
  ["f-resp", "PP-FFP2-20", "Máscara FFP2 com válvula (cx 20)", "EN 149:2001+A1:2009.", 18.9, "cx", 12],
  ["f-resp", "PP-FFP3-10", "Máscara FFP3 com válvula (cx 10)", "EN 149:2001+A1:2009.", 24.5, "cx", 12],
  ["f-discos", "AT-INOX-115", "Disco corte inox 115×1,0×22,23", "Sem ferro, enxofre ou cloro. Corte rápido e limpo.", 1.1, "un", 25],
  ["f-discos", "AT-INOX-125", "Disco corte inox 125×1,0×22,23", "Sem ferro, enxofre ou cloro. Corte rápido e limpo.", 1.25, "un", 25],
  ["f-discos", "AT-INOX-230", "Disco corte inox 230×1,9×22,23", "Para rebarbadoras grandes.", 3.4, "un", 25],
  ["f-lixas", "AT-LAM-125-40", "Disco lamelas zircónio 125 G40", "Base fibra de vidro, desbaste agressivo.", 2.95, "un", 10],
  ["f-lixas", "AT-LAM-125-80", "Disco lamelas zircónio 125 G80", "Base fibra de vidro, acabamento.", 2.95, "un", 10, true],
  ["f-manuais", "TM-ROQ-94", "Jogo chaves de caixa 1/2\" 94 peças", "Crómio-vanádio, mala metálica.", 129.0, "un", 1],
  ["f-manuais", "TM-COMB-12", "Jogo chaves combinadas 6–22 mm (12 pç)", "Crómio-vanádio, suporte em plástico.", 39.9, "un", 4],
  ["f-manuais", "TM-ALIC-200", "Alicate universal 200 mm", "Isolado 1000 V, VDE.", 14.6, "un", 6],
  ["f-manuais", "TM-XACT-18", "X-acto 18 mm com 5 lâminas", "Bloqueio automático, corpo metálico.", 4.2, "un", 12],
  ["f-medicao", "TM-FITA-8", "Fita métrica 8 m × 25 mm", "Classe II, fita com revestimento nylon.", 9.8, "un", 6],
  ["f-medicao", "TM-NIVEL-60", "Nível alumínio 60 cm", "3 bolhas, precisão 0,5 mm/m.", 16.5, "un", 5],
  ["f-fix", "FL-BUCHA-8", "Bucha nylon 8 mm (cx 100)", "Para betão e tijolo maciço.", 4.6, "cx", 10],
  ["f-fix", "FL-PAR-4540", "Parafuso aglomerado 4,5×40 (cx 200)", "Zincado, cabeça de embeber, Pozi.", 6.2, "cx", 10],
  ["f-quim", "FL-DESC-400", "Desengordurante multiusos 400 ml", "Spray, secagem rápida.", 5.4, "un", 12],
  ["f-quim", "FL-SIL-280", "Silicone neutro transparente 280 ml", "Uso interior e exterior.", 4.9, "un", 24, true],
  ["f-calcado", "PP-BOTA-S3", "Bota segurança S3 CI SRC", "Biqueira composite, isolamento ao frio. Escolha o tamanho ao encomendar.", 62.0, "par", 1, true],
];

export const seedProducts: Product[] = rows.map(([familyId, reference, designation, description, , salesUnit, packQty, isNew], i) => ({
  id: `p-${i + 1}`,
  manufacturerId: seedFamilies.find((f) => f.id === familyId)!.manufacturerId,
  familyId,
  reference,
  designation,
  description,
  salesUnit,
  packQty,
  moq: packQty,
  isNew: Boolean(isNew),
  sizeType: reference === "PP-BOTA-S3" ? "calcado" : null,
}));

export const seedPrices: Record<string, number> = Object.fromEntries(rows.map((r, i) => [`p-${i + 1}`, r[4]]));

export const seedCampaigns: Campaign[] = [
  {
    id: "c-1",
    title: "Jogo de chaves de caixa 94 peças",
    subtitle: "Campanha de stock até ao fim do mês",
    badge: "-35%",
    manufacturerId: "m-fer",
    productId: "p-15",
  },
  {
    id: "c-2",
    title: "Nova luva anticorte nível C",
    subtitle: "Mais proteção, a mesma destreza",
    badge: "Novidade",
    manufacturerId: "m-epi",
    productId: "p-3",
  },
];

export const seedClients: Client[] = [
  { id: "cl-1", name: "Ferragens do Minho, Lda.", nif: "500000000", email: "compras@ferragens-minho.example", phone: "258 000 000", address: "Viana do Castelo" },
  { id: "cl-2", name: "Industrial Norte Distribuição", nif: "501000000", email: "geral@industrialnorte.example", address: "Braga" },
];

export const seedRules: DiscountRule[] = [
  // Campanha geral: chave de caixa com 35% para todos.
  { id: "r-1", manufacturerId: "m-fer", productId: "p-15", discounts: [35] },
  // Ferragens do Minho: descontos por fabricante.
  { id: "r-2", clientId: "cl-1", manufacturerId: "m-epi", discounts: [35, 5] },
  { id: "r-3", clientId: "cl-1", manufacturerId: "m-abr", discounts: [40] },
  { id: "r-4", clientId: "cl-1", manufacturerId: "m-fer", discounts: [30] },
  // Preço líquido especial num artigo.
  { id: "r-5", clientId: "cl-1", manufacturerId: "m-abr", productId: "p-11", discounts: [], specialNetPrice: 0.62 },
];
