# Splash-animation pixel proof, take 2: two full-screen grabs taken while
# the splash is definitely up (orchestrated to land ~3.0-3.5s post-launch),
# differenced within three crops:
#   icon   — must change (pulse + gloss)
#   title  — must NOT change (static text = motion is localized to the icon)
#   control— outside the splash entirely (must be ~quiet)
import sys
import time
from PIL import Image, ImageChops, ImageGrab

SPLASH = (750, 284, 1170, 844)          # known splash geometry
ICON = (832, 404, 1088, 660)            # icon panel inside it
TITLE = (810, 716, 1110, 780)           # "TCG Life" label inside it
CONTROL = (1400, 300, 1800, 700)        # outside the splash

ImageGrab.grab()  # warm-up
time.sleep(0.5)
a = ImageGrab.grab()
time.sleep(0.4)
b = ImageGrab.grab()

def changed(box):
    d = ImageChops.difference(a.crop(box).convert("RGB"), b.crop(box).convert("RGB"))
    h = d.convert("L").histogram()
    return sum(h[8:])

icon, title, ctrl = changed(ICON), changed(TITLE), changed(CONTROL)
print("icon region changed:   %6d px (expect >500 — animating)" % icon)
print("title region changed:  %6d px (expect ~0 — static text)" % title)
print("control region changed:%6d px (desktop noise floor)" % ctrl)
ok = icon > 500 and title < 200
print("VERDICT:", "ANIMATING" if ok else "INCONCLUSIVE")
sys.exit(0 if ok else 1)
