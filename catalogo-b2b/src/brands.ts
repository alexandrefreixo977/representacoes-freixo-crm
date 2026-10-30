import type { Catalog, Manufacturer } from "./types";

/** Grupos de marcas iguais aos do site representacoesfreixo.com. O grupo sai da ordem (sort) da marca. */
export const BRAND_GROUPS = [
  { id: "epi", label: "EPI", long: "Equipamentos de Proteção Individual", hint: "Calçado, vestuário, luvas e proteção" },
  { id: "industrial", label: "Equipamentos e consumíveis", long: "Equipamentos e consumíveis industriais", hint: "Ferramentas, abrasivos, serras e consumíveis" },
] as const;

export type BrandGroupId = (typeof BRAND_GROUPS)[number]["id"];

export const brandGroup = (m: Pick<Manufacturer, "sort">): BrandGroupId => (m.sort >= 200 ? "industrial" : "epi");

/** Marcas de cada grupo, pela ordem da loja. */
export function groupedBrands(catalog: Catalog | null) {
  return BRAND_GROUPS.map((g) => ({ ...g, brands: (catalog?.manufacturers ?? []).filter((m) => brandGroup(m) === g.id) })).filter(
    (g) => g.brands.length > 0
  );
}
