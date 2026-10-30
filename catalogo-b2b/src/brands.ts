import type { Manufacturer } from "./types";

/** Grupos de marcas iguais aos do site representacoesfreixo.com. O grupo sai da ordem (sort) da marca. */
export const BRAND_GROUPS = [
  { id: "epi", label: "EPI" },
  { id: "industrial", label: "Equipamentos e consumíveis industriais" },
] as const;

export const brandGroup = (m: Pick<Manufacturer, "sort">) => (m.sort >= 200 ? "industrial" : "epi");
