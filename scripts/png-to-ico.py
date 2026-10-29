# Packs assets/icon.png into assets/icon.ico (multi-size, 32-bit BGRA BMP entries).
# Entries are proper DIBs: BITMAPINFOHEADER with doubled height, bottom-up BGRA
# rows, and an empty AND mask (alpha lives in the 32-bit channel).
from struct import pack

from PIL import Image

SRC = "assets/icon.png"
OUT = "assets/icon.ico"
SIZES = [16, 24, 32, 48, 64, 128, 256]

base = Image.open(SRC).convert("RGBA")
if base.size != (256, 256):
    base = base.resize((256, 256), Image.LANCZOS)

entries = []
for s in SIZES:
    img = base.resize((s, s), Image.LANCZOS)
    px = img.load()
    # bottom-up BGRA rows
    rows = []
    for y in range(s - 1, -1, -1):
        row = bytearray()
        for x in range(s):
            r, g, b, a = px[x, y]
            row += pack("<BBBB", b, g, r, a)
        rows.append(bytes(row))
    xor = b"".join(rows)
    and_stride = ((s + 31) // 32) * 4  # 1bpp mask, DWORD-aligned rows
    and_mask = b"\x00" * (and_stride * s)

    dib = pack(
        "<IiiHHIIiiII",
        40,           # biSize (BITMAPINFOHEADER)
        s,            # biWidth
        s * 2,        # biHeight (XOR + AND)
        1,            # biPlanes
        32,           # biBitCount
        0,            # biCompression (BI_RGB)
        len(xor) + len(and_mask),
        0, 0, 0, 0,
    )
    entries.append((s, dib + xor + and_mask))

header = pack("<HHH", 0, 1, len(entries))
directory = b""
offset = 6 + 16 * len(entries)
for s, data in entries:
    directory += pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(data), offset)
    offset += len(data)

with open(OUT, "wb") as f:
    f.write(header + directory + b"".join(d for _, d in entries))
print(f"{OUT} written with sizes {SIZES}")
