# Build app icons / avatars from the new mascot image.
from PIL import Image, ImageDraw
import os

A = r'D:\mini-14\assets'
src = Image.open(os.path.join(A, 'mascot-v2.img')).convert('RGB')
w, h = src.size
side = min(w, h)
left = (w - side) // 2
top = (h - side) // 2
square = src.crop((left, top, left + side, top + side))

# full mascot
square.resize((512, 512), Image.LANCZOS).save(os.path.join(A, 'mascot-v2.jpg'), quality=95)
square.resize((512, 512), Image.LANCZOS).save(os.path.join(A, 'mascot.png'))

# app icon
icon = square.resize((256, 256), Image.LANCZOS)
icon.save(os.path.join(A, 'icon.png'))
icon.save(os.path.join(A, 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

# chat avatar (face crop: upper-center area)
fx = int(side * 0.50)
fy = int(side * 0.38)
fr = int(side * 0.34)
face = square.crop((max(0, fx - fr), max(0, fy - fr), min(side, fx + fr), min(side, fy + fr)))
face = face.resize((256, 256), Image.LANCZOS)
face.save(os.path.join(A, 'fishmaid.png'))

# welcome avatar: circular, transparent corners
av = square.resize((512, 512), Image.LANCZOS).convert('RGBA')
mask = Image.new('L', (512, 512), 0)
ImageDraw.Draw(mask).ellipse((0, 0, 512, 512), fill=255)
av.putalpha(mask)
av.save(os.path.join(A, 'fishmaid-avatar.png'))

print('done', square.size)
