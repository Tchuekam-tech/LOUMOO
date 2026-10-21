#!/usr/bin/env python3
"""Generate the 1200x630 social-sharing card (Open Graph / Twitter) from the brand assets.

    python scripts/generate_og_image.py

Output: Assets/brand/og-loumoo-1200x630.png

The default og:image used to be the 192px app icon, which every platform crops or
refuses (Facebook wants >= 600px, a 1.91:1 card). This composes the REAL wordmark on a
clean card with the site's own tagline; it invents no claim, badge or statistic.
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
WORDMARK = os.path.join(ROOT, 'Assets', 'brand', 'loumoo-wordmark.png')
OUT = os.path.join(ROOT, 'Assets', 'brand', 'og-loumoo-1200x630.png')

W, H = 1200, 630
BLUE = (0, 37, 229)          # theme-color #0025E5
INK = (17, 18, 20)           # --color-text
SOFT = (82, 87, 99)          # --color-text-secondary
BG = (245, 247, 250)         # --color-bg

TAGLINE = 'La marketplace pour acheter, vendre et voyager au Cameroun'
URL = 'www.loumoo.store'


def font(candidates, size):
    for name in candidates:
        for base in (r'C:\Windows\Fonts', '/usr/share/fonts/truetype/dejavu', '/Library/Fonts'):
            path = os.path.join(base, name)
            if os.path.exists(path):
                return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def wrap(draw, text, fnt, max_width):
    lines, line = [], ''
    for word in text.split():
        trial = (line + ' ' + word).strip()
        if draw.textlength(trial, font=fnt) <= max_width:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def main():
    img = Image.new('RGB', (W, H), BG)
    draw = ImageDraw.Draw(img)

    mark = Image.open(WORDMARK).convert('RGBA')
    mark = mark.crop(mark.getbbox())
    target_w = 720
    mark = mark.resize((target_w, round(mark.height * target_w / mark.width)), Image.LANCZOS)
    mx = (W - mark.width) // 2
    my = 150
    img.paste(mark, (mx, my), mark)

    tag_font = font(['segoeuib.ttf', 'arialbd.ttf', 'DejaVuSans-Bold.ttf'], 38)
    lines = wrap(draw, TAGLINE, tag_font, 880)
    y = my + mark.height + 54
    for line in lines:
        w = draw.textlength(line, font=tag_font)
        draw.text(((W - w) / 2, y), line, font=tag_font, fill=INK)
        y += 52

    url_font = font(['segoeui.ttf', 'arial.ttf', 'DejaVuSans.ttf'], 28)
    w = draw.textlength(URL, font=url_font)
    draw.text(((W - w) / 2, y + 14), URL, font=url_font, fill=SOFT)

    draw.rectangle([0, H - 18, W, H], fill=BLUE)

    img.save(OUT, 'PNG', optimize=True)
    print('wrote', os.path.relpath(OUT, ROOT), os.path.getsize(OUT) // 1024, 'KB')


if __name__ == '__main__':
    sys.exit(main())
