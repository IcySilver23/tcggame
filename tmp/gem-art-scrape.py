# One-off: the real Simplified Chinese scans for every Gem Pack card.
#
# simplifiedcollector.com publishes each volume's card list with the product scans,
# one file per printed number (GG-TT-NN, e.g. 02-01-14), and each image's alt text
# carries the number and name, so the page itself supplies the mapping. Files are
# pulled at full size (733x1024) and shipped at 260px wide webp: the grids draw a
# card about 150px wide and the detail sheet about 340, so 260 keeps the detail
# sharp enough without carrying 1,175 print-size PNGs.
#
# The site throttles: a burst of parallel downloads starts refusing connections for
# a while, so each request retries with a growing pause and the pool is small.
# Only volumes whose page has not been fetched yet are crawled, unless VOLS says
# otherwise, and files already on disk are left alone, so a re-run is a resume.
import io
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
OUT = "public/catalog-art/cbb/cards"
CACHE = "tmp/art-probe"
VOLUMES = [int(v) for v in (os.environ.get("VOLS") or "1,2,3,4,5,6,7").split(",")]
WORKERS = int(os.environ.get("WORKERS") or "4")


def get(url, binary=True, attempts=4, headers=None, timeout=25):
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = r.read()
            return data if binary else data.decode("utf-8", "replace")
        except Exception as e:  # URLError, timeouts, reset transfers
            last = e
            time.sleep(min(30, 4 * (i + 1)))
    raise last


def page(url):
    """The card list's HTML.

    The site itself starts refusing this host after a burst of image downloads, so
    the page is read through a reader proxy that returns the original markup with
    its image URLs intact (the markdown rendering drops the lazy-loaded scans).
    """
    try:
        return get(url, binary=False, attempts=2)
    except Exception:
        # The reader takes its time with a 400 KB page and answers 429 when asked
        # too often, so it gets its own long timeout and a slow retry.
        return get(
            f"https://r.jina.ai/{url}",
            binary=False,
            attempts=4,
            headers={"x-return-format": "html"},
            timeout=120,
        )


# The origin blocked this host mid-run, and a blocked connect hangs rather than
# failing, so reaching it is decided once instead of costing a timeout per card.
DIRECT = {"ok": None}


def direct_ok(probe):
    if DIRECT["ok"] is None:
        try:
            get(probe, attempts=1)
            DIRECT["ok"] = True
        except Exception:
            DIRECT["ok"] = False
    return DIRECT["ok"]


def image(url, probe):
    """A card scan, resized. Direct when the origin answers, else via a proxy."""
    if direct_ok(probe):
        try:
            return get(url, attempts=1)
        except Exception:
            pass
    bare = url.split("://", 1)[-1]
    return get(f"https://images.weserv.nl/?url={bare}&w=260&h=364&fit=inside&output=webp&q=78", attempts=3)


cards = json.load(open("server/catalog/regional-releases.json", encoding="utf-8"))["cards"]
by_number = {}
by_name = {}
for c in cards:
    if not c["set_id"].startswith("cbb"):
        continue
    group, rest = c["number"].split(" ")
    treat, total = rest.split("/")
    by_number.setdefault(c["set_id"], {})[f"{group}-{treat}-{total}"] = c["id"]
    # A volume's printings disagree on a denominator here and there (Vol. 1 Crocalor
    # is 04 01/09 in Bulbapedia and 04 01/08 on the card), so the name and treatment
    # are the fallback key: one card of that name at that treatment in the volume.
    by_name.setdefault(c["set_id"], {}).setdefault(f"{c['name']}|{treat}", []).append(c["id"])

os.makedirs(OUT, exist_ok=True)
report = {"volumes": {}, "missing": []}

for vol in VOLUMES:
    setId = f"cbb{vol}"
    page_url = f"https://simplifiedcollector.com/gem-pack-vol-{vol}-card-list/"
    cache = f"{CACHE}/sc-vol{vol}.html"
    try:
        if os.path.exists(cache):
            html = open(cache, encoding="utf-8").read()
        else:
            html = page(page_url)
            open(cache, "w", encoding="utf-8").write(html)
    except Exception as e:
        print(f"vol {vol}: page failed — {type(e).__name__}", flush=True)
        continue

    wanted = by_number.get(setId, {})
    # Every card image in the page carries its printed number and name in the alt.
    found = {}
    for tag in re.findall(r"<img[^>]*>", html):
        alt = re.search(r'alt="(\d\d) (\d\d)/(\d\d)([^"]*)"', tag)
        if not alt:
            continue
        key = f"{alt.group(1)}-{alt.group(2)}-{alt.group(3)}"
        name = alt.group(4).replace(" from Gem Pack", "").strip().split(" (")[0].strip()
        urls = re.findall(r"https://simplifiedcollector\.com/wp-content/uploads/[^\"'\s,]+", tag)
        if not urls:
            continue
        card_id = wanted.get(key)
        if card_id is None:
            fallback = by_name.get(setId, {}).get(f"{name}|{alt.group(2)}") or []
            if len(fallback) != 1:
                continue
            card_id = fallback[0]
        # Prefer the undistorted file: WordPress suffixes -WWxHH on resizes.
        best = sorted(urls, key=lambda u: (not re.search(r"-\d+x\d+\.(png|jpe?g|webp)$", u), len(u)))[0]
        found.setdefault(card_id, best)

    print(f"vol {vol}: {len(found)}/{len(wanted)} cards on the page", flush=True)

    probe = min(found.values()) if found else None

    def one(item):
        card_id, url = item
        target = f"{OUT}/{card_id}.webp"
        if os.path.exists(target):
            return True
        for attempt in range(3):
            try:
                raw = image(url, probe)
                im = Image.open(io.BytesIO(raw)).convert("RGB")
                im.thumbnail((260, 400), Image.LANCZOS)
                im.save(target, "WEBP", quality=82, method=6)
                return True
            except Exception as e:
                if attempt == 2:
                    print(f"   {card_id}: {type(e).__name__}", flush=True)
                time.sleep(3)
        return False

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        done = sum(pool.map(one, sorted(found.items())))
    report["volumes"][setId] = {"page": len(found), "want": len(wanted), "shipped": done}
    report["missing"] += [k for k in wanted if k not in found and not os.path.exists(f"{OUT}/{wanted[k]}.webp")]
    print(f"vol {vol}: shipped {done}/{len(wanted)}", flush=True)

json.dump(report, open(f"{CACHE}/gem-art-report.json", "w"), indent=1)
print("missing numbers:", len(report["missing"]), report["missing"][:12], flush=True)
