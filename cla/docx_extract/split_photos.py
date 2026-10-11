# -*- coding: utf-8 -*-
from PIL import Image
import os
base = r'd:\yjs\docx_extract'

# 基于整网格图的已验证黑线（含外框的四条线中心），直接等分切图
# (网格图, [4条竖线x], [4条横线y])
JOBS = {
    '付志成': ('grid_fu.png', [28, 206, 388, 566], [4, 205, 449, 687]),
    '何瑞淇': ('grid_he.png', [50, 223, 399, 571], [3, 193, 428, 659]),
    '王若涵': ('grid_wang.png', [43, 163, 284, 402], [3, 176, 337, 495]),
}
for name, (gf, v, h) in JOBS.items():
    g = Image.open(os.path.join(base, gf)).convert('RGB')
    outdir = os.path.join(base, name + '_photos')
    os.makedirs(outdir, exist_ok=True)
    for f in os.listdir(outdir): os.remove(os.path.join(outdir, f))
    n = 0
    for ri in range(3):
        for ci in range(3):
            x0 = v[ci] + (3 if ci else 2)
            x1 = v[ci+1] - 3
            y0 = h[ri] + (3 if ri else 2)
            y1 = h[ri+1] - 3
            cell = g.crop((x0, y0, x1, y1))
            n += 1
            cell.save(os.path.join(outdir, f'{n}.jpg'), quality=92)
    print(name, [Image.open(os.path.join(outdir, f'{i}.jpg')).size for i in range(1, 10)])
