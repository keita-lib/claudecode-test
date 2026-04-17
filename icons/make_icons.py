import struct, zlib, math

def png(width, height, pixels):
    def chunk(name, data):
        c = struct.pack('>I', len(data)) + name + data
        return c + struct.pack('>I', zlib.crc32(name + data) & 0xffffffff)

    raw = b''
    for row in pixels:
        raw += b'\x00'
        for r, g, b, a in row:
            raw += bytes([r, g, b, a])

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    # RGBA
    ihdr = struct.pack('>II', width, height) + bytes([8, 6, 0, 0, 0])
    idat = zlib.compress(raw)
    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', ihdr)
        + chunk(b'IDAT', idat)
        + chunk(b'IEND', b'')
    )

def make_icon(size):
    pixels = [[(0, 0, 0, 0)] * size for _ in range(size)]
    r = size // 2
    bg = (79, 70, 229, 255)
    white = (255, 255, 255, 255)

    # fill rounded rect background
    corner = int(size * 0.15)
    for y in range(size):
        for x in range(size):
            in_rect = True
            # corner checks
            if x < corner and y < corner:
                in_rect = math.hypot(x - corner, y - corner) <= corner
            elif x > size - 1 - corner and y < corner:
                in_rect = math.hypot(x - (size - 1 - corner), y - corner) <= corner
            elif x < corner and y > size - 1 - corner:
                in_rect = math.hypot(x - corner, y - (size - 1 - corner)) <= corner
            elif x > size - 1 - corner and y > size - 1 - corner:
                in_rect = math.hypot(x - (size - 1 - corner), y - (size - 1 - corner)) <= corner
            if in_rect:
                pixels[y][x] = bg

    # draw mic body (rounded rectangle)
    cx = size / 2
    mic_cy = size * 0.38
    mw = size * 0.16
    mh = size * 0.24
    mic_r = mw * 0.8

    for y in range(size):
        for x in range(size):
            dx = x - cx
            dy = y - mic_cy
            # simple ellipse for mic
            if (dx / mw) ** 2 + (dy / mh) ** 2 <= 1.0:
                pixels[y][x] = white

    # draw arc (stand) - approximate with thick arc
    stand_cx = cx
    stand_cy = mic_cy + size * 0.04
    stand_r = size * 0.26
    lw = size * 0.045

    for y in range(size):
        for x in range(size):
            dx = x - stand_cx
            dy = y - stand_cy
            dist = math.hypot(dx, dy)
            if abs(dist - stand_r) <= lw and dy <= 0:
                pixels[y][x] = white

    # vertical line stem
    stem_x = int(cx)
    stem_y_start = int(mic_cy + size * 0.28)
    stem_y_end = int(mic_cy + size * 0.38)
    sw = max(int(size * 0.045), 2)
    for y in range(stem_y_start, stem_y_end + 1):
        for x in range(stem_x - sw, stem_x + sw + 1):
            if 0 <= x < size and 0 <= y < size:
                pixels[y][x] = white

    # horizontal base
    base_y = stem_y_end
    base_w = int(size * 0.12)
    for x in range(int(cx) - base_w, int(cx) + base_w + 1):
        for y in range(base_y - sw, base_y + sw + 1):
            if 0 <= x < size and 0 <= y < size:
                pixels[y][x] = white

    return png(size, size, pixels)

for size in [192, 512]:
    data = make_icon(size)
    with open(f'icon-{size}.png', 'wb') as f:
        f.write(data)
    print(f'Created icon-{size}.png ({len(data)} bytes)')
