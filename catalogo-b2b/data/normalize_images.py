"""Põe todas as fotos dos artigos no mesmo formato: quadrado branco de 500x500, produto centrado e com a mesma margem.

Uso: python3 data/normalize_images.py public/img/cofra public/img/cofra-vestuario public/img/aghasa public/img/bluemaster
Correr sempre depois de extrair fotos novas (data/extract_*_images.py). Pode correr-se várias vezes: o resultado é o mesmo.
Precisa de: pillow.

1. Corta o fundo branco (ou quase branco) à volta do produto.
2. Encaixa o produto numa área de 440x440, sem deformar.
3. Cola-o no centro de um quadrado branco de 500x500.
"""
import pathlib
import sys

from PIL import Image, ImageChops

SIZE, BOX = 500, 440


def normalize(path: pathlib.Path) -> None:
    img = Image.open(path).convert("RGB")
    white = Image.new("RGB", img.size, "white")
    diff = ImageChops.difference(img, white).convert("L").point(lambda v: 255 if v > 18 else 0)
    box = diff.getbbox()
    if box:
        img = img.crop(box)
    img.thumbnail((BOX, BOX), Image.LANCZOS)
    if img.width < BOX and img.height < BOX:  # fotos pequenas: aumentar até encaixar
        k = min(BOX / img.width, BOX / img.height)
        img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
    canvas = Image.new("RGB", (SIZE, SIZE), "white")
    canvas.paste(img, ((SIZE - img.width) // 2, (SIZE - img.height) // 2))
    canvas.save(path, "JPEG", quality=80, optimize=True)


if __name__ == "__main__":
    n = 0
    for folder in sys.argv[1:]:
        for p in sorted(pathlib.Path(folder).glob("*.jpg")):
            normalize(p)
            n += 1
    print(f"{n} fotos normalizadas")
