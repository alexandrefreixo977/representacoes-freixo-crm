// Contagem de visitas sem cookies: um identificador aleatório por browser, guardado no localStorage.
const KEY = "freixo-visitante";

export function visitorId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id || !/^[A-Za-z0-9_-]{8,40}$/.test(id)) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 24);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

/** Página e marca de um endereço da loja, para as estatísticas (sem pesquisas nem dados do cliente). */
export function visitPage(page: string, params: URLSearchParams) {
  const brand = page === "" ? (params.get("m") || null) : null;
  const name = page || "catalogo";
  return { page: brand ? `${name}/${brand}` : name, brand };
}
