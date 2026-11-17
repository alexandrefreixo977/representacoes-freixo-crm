/* Contador de visitas do site institucional da Representações Freixo (sem cookies, sem IP).
   Colocar no site: <script async src="https://b2b.representacoesfreixo.com/visitas.js"></script> */
(function () {
  try {
    var k = "freixo-visitante", id = localStorage.getItem(k);
    if (!id || !/^[A-Za-z0-9_-]{8,40}$/.test(id)) {
      id = Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
      localStorage.setItem(k, id);
    }
    var page = (location.pathname || "/").slice(0, 200);
    fetch("__URL__/rest/v1/rpc/b2b_track_visit", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", apikey: "__KEY__", Authorization: "Bearer __KEY__" },
      body: JSON.stringify({ p_site: "site", p_visitor: id, p_page: page, p_brand: null })
    }).catch(function () {});
  } catch (e) {}
})();
