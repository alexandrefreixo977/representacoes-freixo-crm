-- Fotos inválidas: alguns artigos tinham no campo da foto um texto ("No encontrado") ou o link da página do produto
-- em vez da imagem, e a loja mostrava uma imagem partida. Passam a não ter foto (a loja mostra o espaço vazio normal)
-- até haver a foto certa. Corre depois das migrações de fotos de 13/11/2026.
update public.b2b_products
set image_url = null, updated_at = now()
where image_url is not null
  and (image_url !~* '^(/|https?://)'
       or image_url ~* '^https?://(www\.)?uniortools\.com/[a-z]{2}/product/');
