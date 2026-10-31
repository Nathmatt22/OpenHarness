# OpenHarness icon
# Brand color gradient: violet #8b7bf7 -> blue #5a8bd4. Mark: "h"-like connector glyph.

import struct, zlib, os

def png_chunk(kind, data):
    return len(data).to_bytes(4, 'big') + kind + data + zlib.crc32(kind + data).to_bytes(4, 'big')

def write_png(path, size, pixels):
    # pixels: list of rows, each row = list of (r,g,b,a)
    raw = b''.join(b'\x00' + b''.join(struct.pack('4B', *p) for p in row) for row in pixels)
    png = b'\x89PNG\r\n\x1a\n'
    png += png_chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += png_chunk(b'IDAT', zlib.compress(raw, 9))
    png += png_chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

VIOLET = (139, 123, 247)
BLUE = (90, 139, 212)
BG_DARK = (12, 13, 17)

def rounded_alpha(x, y, size, radius):
    # inside rounded-rect test
    if x < radius and y < radius and (radius - x) ** 2 + (radius - y) ** 2 > radius ** 2: return False
    if x >= size - radius and y < radius and (x - (size - radius - 1)) ** 2 + (radius - y) ** 2 > radius ** 2: return False
    if x < radius and y >= size - radius and (radius - x) ** 2 + (y - (size - radius - 1)) ** 2 > radius ** 2: return False
    if x >= size - radius and y >= size - radius and (x - (size - radius - 1)) ** 2 + (y - (size - radius - 1)) ** 2 > radius ** 2: return False
    return True

def render(size):
    radius = size * 22 // 100
    stroke = max(2, size // 10)
    margin = size * 22 // 100
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            # diagonal gradient background
            t = (x + y) / (2 * size)
            if rounded_alpha(x, y, size, radius):
                r, g, b = lerp(VIOLET, BLUE, t)
                a = 255
                # glyph: horizontal top bar, curve down-left, vertical stem (h-like harness mark)
                gx0, gy0 = margin, margin
                gx1, gy1 = size - margin, size - margin
                mid_y = (gy0 + gy1) // 2
                on = False
                # top horizontal bar
                if gy0 <= y < gy0 + stroke and gx0 <= x <= gx1 - stroke:
                    on = True
                # left vertical from bar down to mid
                if gx0 <= x < gx0 + stroke and gy0 <= y <= mid_y + stroke // 2:
                    on = True
                # right vertical full height
                if gx1 - stroke <= x < gx1 and gy0 + stroke <= y <= gy1:
                    on = True
                if on:
                    r, g, b = (255, 255, 255)
                    a = 255
            else:
                r = g = b = 0
                a = 0
            row.append((r, g, b, a))
        rows.append(row)
    return rows

os.makedirs('build/icon', exist_ok=True)
for size in (16, 24, 32, 48, 64, 128, 256, 512):
    write_png(f'build/icon/{size}.png', size, render(size))
print('icons written:', sorted(os.listdir('build/icon')))

# --- Installer header bitmap (NSIS MUI_HEADERIMAGE_BITMAP, 150x57 BMP) ---
def bmp_header(width, height, data_size):
    # BITMAPFILEHEADER + BITMAPINFOHEADER + 8-bit palette (dark, violet, blue, white)
    pal = bytes([0x0c,0x0d,0x11,0x00, 0x8b,0x7b,0xf7,0x00, 0x5a,0x8b,0xd4,0x00, 0xff,0xff,0xff,0x00])
    off = 14 + 40 + len(pal)
    fh = struct.pack('<2IHHI', 0x424D, data_size + off, 0, 0, off)
    ih = struct.pack('<IiiHHIIiiII', 40, width, -height, 1, 8, 0, data_size, 0, 0, 4, 0)
    return fh + ih + pal

def write_bmp_150x57(path):
    # NSIS MUI_HEADERIMAGE_BITMAP must be 150x57 for the default header placement.
    w, h = 150, 57
    row_size = ((w + 3) // 4) * 4
    data = bytearray()
    # gradient columns violet->blue, white harness glyph strip on the right
    for y in range(h):
        row = bytearray()
        for x in range(w):
            t = x / w
            r, g, b = lerp(VIOLET, BLUE, t)
            # right-side vertical bar of the "h" mark
            if 118 <= x < 124 and 6 <= y < 52:
                r, g, b = 255, 255, 255
            if 36 <= x < 118 and 6 <= y < 12:
                r, g, b = 255, 255, 255
            row += bytes([3 if (r, g, b) == (255, 255, 255) else (1 if (r, g, b) == VIOLET else (2 if (r, g, b) == BLUE else 0))])
        data += bytes(row) + b'\x00' * (row_size - w)
    with open(path, 'wb') as f:
        f.write(bmp_header(w, h, len(data)))
        f.write(bytes(data))

write_bmp_150x57('build/installerHeader.bmp')
print('installer header written: build/installerHeader.bmp')
