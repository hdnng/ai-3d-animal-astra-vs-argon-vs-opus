"""Build the comparison assets for the root README from the three model folders.

Reads only the result files each model produced (bench/longrun JSON, dist/, src/,
screenshots/) and writes everything into report/. Model folders are never modified.

    python report/scripts/build_assets.py
"""
import glob
import gzip
import json
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_ASSETS = os.path.join(ROOT, "report", "assets")
OUT_DATA = os.path.join(ROOT, "report", "data")

MODELS = [
    ("argon", "Gemini 4 Argon (high)"),
    ("astra", "Astra 6 (xhigh)"),
    ("opus", "Opus 5.5 (xhigh)"),
]


def load(path):
    with open(os.path.join(ROOT, path), encoding="utf8") as f:
        return json.load(f)


def count_lines(paths):
    total = 0
    for p in paths:
        with open(p, encoding="utf8", errors="ignore") as f:
            total += len(f.read().splitlines())
    return total


def code_stats(model):
    src = [p for p in glob.glob(os.path.join(ROOT, model, "src", "**", "*"), recursive=True) if os.path.isfile(p)]
    tests = [
        p
        for d in ("tests", "scripts")
        for p in glob.glob(os.path.join(ROOT, model, d, "**", "*"), recursive=True)
        if os.path.isfile(p)
    ]
    raw = gz = 0
    for p in glob.glob(os.path.join(ROOT, model, "dist", "**", "*"), recursive=True):
        if os.path.isfile(p):
            data = open(p, "rb").read()
            raw += len(data)
            gz += len(gzip.compress(data, 9))
    return {
        "srcFiles": len(src),
        "srcLines": count_lines(src),
        "testFiles": len(tests),
        "testLines": count_lines(tests),
        "distBytes": raw,
        "distGzipBytes": gz,
        "screenshots": len(glob.glob(os.path.join(ROOT, model, "screenshots", "*.png"))),
    }


def bench_summary():
    a = load("argon/bench-results.json")
    s = load("astra/bench-results.json")
    o = load("opus/bench-results.json")
    o_adapt, o_fixed = o["results"][0], o["results"][1]
    # "wallClockFps" = frames actually counted / measurement window. It exposes frames
    # that a harness filtered out (Argon drops >=500 ms frames, Opus drops >=2000 ms).
    return [
        {
            "model": "argon", "config": "adaptive (default), Vite dev server, vsync off",
            "viewport": "1280x720", "reportedFps": a["averageFps"],
            "wallClockFps": round(a["totalFrames"] / a["durationSeconds"], 1),
            "onePercentLow": a["onePercentLowFps"], "p99Ms": a["p99FrameTimeMs"],
            "frames": a["totalFrames"], "seconds": a["durationSeconds"],
            "countedSeconds": round(a["totalFrames"] * a["averageFrameTimeMs"] / 1000, 1),
        },
        {
            "model": "astra", "config": "adaptive (default), production preview",
            "viewport": "1440x900", "reportedFps": round(s["averageFPS"], 2),
            "wallClockFps": round(s["frameCount"] / s["durationSeconds"], 1),
            "onePercentLow": round(s["onePercentLowFPS"], 2), "p99Ms": round(s["p99FrameTimeMs"], 1),
            "frames": s["frameCount"], "seconds": s["durationSeconds"],
            "countedSeconds": round(s["frameCount"] * s["averageFrameTimeMs"] / 1000, 1),
        },
        {
            "model": "opus", "config": "adaptive (default), production preview",
            "viewport": "1280x720", "reportedFps": o_adapt["avgFps"],
            "wallClockFps": round(o_adapt["frames"] / o_adapt["seconds"], 1),
            "onePercentLow": o_adapt["low1PercentFps"], "p99Ms": o_adapt["frameTimeMs"]["p99"],
            "frames": o_adapt["frames"], "seconds": o_adapt["seconds"],
            "countedSeconds": round(o_adapt["frames"] * o_adapt["frameTimeMs"]["avg"] / 1000, 1),
        },
        {
            "model": "opus", "config": "fixed high quality, production preview",
            "viewport": "1280x720", "reportedFps": o_fixed["avgFps"],
            "wallClockFps": round(o_fixed["frames"] / o_fixed["seconds"], 1),
            "onePercentLow": o_fixed["low1PercentFps"], "p99Ms": o_fixed["frameTimeMs"]["p99"],
            "frames": o_fixed["frames"], "seconds": o_fixed["seconds"],
            "countedSeconds": round(o_fixed["frames"] * o_fixed["frameTimeMs"]["avg"] / 1000, 1),
        },
    ]


def fps_chart(rows):
    labels = [
        "Gemini 4 Argon · adaptive",
        "Astra 6 · adaptive",
        "Opus 5.5 · adaptive",
        "Opus 5.5 · fixed high",
    ]
    w, left, right, top = 760, 200, 70, 64
    group_h, bar_h, gap = 58, 18, 2
    plot_w = w - left - right
    h = top + group_h * len(rows) + 52
    max_v = 70.0
    x = lambda v: left + plot_w * v / max_v

    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
        'font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13">',
        "<style>",
        ":root{--bg:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--grid:#e4e3df;--s1:#2a78d6;--s2:#eb6834}",
        "@media (prefers-color-scheme: dark){:root{--bg:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--grid:#3a3936;--s1:#3987e5;--s2:#d95926}}",
        ".bg{fill:var(--bg)}.t{fill:var(--ink)}.t2{fill:var(--ink2)}.g{stroke:var(--grid)}"
        ".s1{fill:var(--s1)}.s2{fill:var(--s2)}.tgt{stroke:var(--ink2)}",
        "</style>",
        f'<rect class="bg" width="{w}" height="{h}" rx="8"/>',
        # legend
        f'<rect class="s1" x="{left}" y="18" width="12" height="12" rx="3"/>',
        f'<text class="t" x="{left + 18}" y="29">Self-reported FPS (README / JSON)</text>',
        f'<rect class="s2" x="{left + 250}" y="18" width="12" height="12" rx="3"/>',
        f'<text class="t" x="{left + 268}" y="29">Wall-clock FPS (frames ÷ 30 s)</text>',
    ]
    for v in range(0, 71, 10):
        out.append(f'<line class="g" x1="{x(v):.1f}" x2="{x(v):.1f}" y1="{top - 8}" y2="{h - 46}" stroke-width="1"/>')
        out.append(f'<text class="t2" x="{x(v):.1f}" y="{h - 28}" text-anchor="middle">{v}</text>')
    out.append(
        f'<line class="tgt" x1="{x(60):.1f}" x2="{x(60):.1f}" y1="{top - 8}" y2="{h - 46}" stroke-width="2" stroke-dasharray="5 4"/>'
    )
    out.append(f'<text class="t2" x="{x(60) + 4:.1f}" y="{top - 12}">60 FPS target</text>')
    for i, (row, label) in enumerate(zip(rows, labels)):
        y0 = top + i * group_h
        out.append(f'<text class="t" x="{left - 12}" y="{y0 + bar_h + 6}" text-anchor="end">{label}</text>')
        for j, (key, cls) in enumerate((("reportedFps", "s1"), ("wallClockFps", "s2"))):
            v = row[key]
            y = y0 + j * (bar_h + gap)
            bw = x(v) - left
            # 4px rounded data-end, square at the baseline
            out.append(
                f'<path class="{cls}" d="M{left},{y} h{bw - 4:.1f} a4,4 0 0 1 4,4 v{bar_h - 8} '
                f'a4,4 0 0 1 -4,4 h{-(bw - 4):.1f} z"><title>{label}: {v} FPS</title></path>'
            )
            out.append(f'<text class="t" x="{x(v) + 6:.1f}" y="{y + bar_h - 4}">{v:g}</text>')
    out.append(f'<text class="t2" x="{left + plot_w / 2:.1f}" y="{h - 8}" text-anchor="middle" font-size="11">Average FPS · 30 s benchmark · Intel UHD 620</text>')
    out.append("</svg>")
    with open(os.path.join(OUT_ASSETS, "fps-comparison.svg"), "w", encoding="utf8") as f:
        f.write("\n".join(out))


def font(size, bold=False):
    for name in (("segoeuib.ttf" if bold else "segoeui.ttf"), "arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(os.path.join("C:/Windows/Fonts", name), size)
        except OSError:
            try:
                return ImageFont.truetype(name, size)
            except OSError:
                pass
    return ImageFont.load_default()


def grid(name, title, picks):
    """Three screenshots side by side, letterboxed to the same 640x400 cell."""
    cell_w, cell_h, pad, head, cap = 640, 400, 16, 56, 34
    W = pad + 3 * (cell_w + pad)
    H = head + cap + cell_h + pad
    img = Image.new("RGB", (W, H), (24, 24, 23))
    d = ImageDraw.Draw(img)
    d.text((pad, 14), title, font=font(24, True), fill=(240, 239, 236))
    for i, ((model, label), (shot, caption)) in enumerate(zip(MODELS, picks)):
        x0 = pad + i * (cell_w + pad)
        d.text((x0, head), label, font=font(18, True), fill=(240, 239, 236))
        d.text((x0 + 230, head + 3), caption, font=font(14), fill=(195, 194, 183))
        src = Image.open(os.path.join(ROOT, model, "screenshots", shot)).convert("RGB")
        scale = min(cell_w / src.width, cell_h / src.height)
        src = src.resize((round(src.width * scale), round(src.height * scale)), Image.LANCZOS)
        cell = Image.new("RGB", (cell_w, cell_h), (12, 12, 12))
        cell.paste(src, ((cell_w - src.width) // 2, (cell_h - src.height) // 2))
        img.paste(cell, (x0, head + cap))
    img.save(os.path.join(OUT_ASSETS, name), quality=86, optimize=True)


def main():
    os.makedirs(OUT_ASSETS, exist_ok=True)
    os.makedirs(OUT_DATA, exist_ok=True)
    rows = bench_summary()
    a_long = None  # Argon did not save a long-run result file
    s_long = load("astra/long-run-results.json")
    o_long = load("opus/longrun-results.json")
    summary = {
        "bench": rows,
        "longRun": {
            "argon": a_long,
            "astra": {"passed": s_long["passed"], "simulatedSeconds": round(s_long["simulatedSeconds"], 1),
                      "heapGrowthMB": round(s_long["heapGrowthMB"], 3)},
            "opus": {"passed": o_long["passed"], "simulatedSeconds": o_long["simulatedSeconds"],
                     "heapGrowthMB": o_long["heapGrowthMB_after60s"], "textureGrowth": o_long["textureGrowth"]},
        },
        "code": {m: code_stats(m) for m, _ in MODELS},
    }
    with open(os.path.join(OUT_DATA, "summary.json"), "w", encoding="utf8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    fps_chart(rows)
    grid("compare-daylight.jpg", "Daytime – follow camera + HUD", [
        ("01-daylight-follow.png", "10:47 · AI cantering across meadow"),
        ("01-afternoon.png", "16:00 · Ember the fox, orbit"),
        ("01_golden_hour_follow_hud.png", "17:10 · alpha wolf, follow"),
    ])
    grid("compare-night.jpg", "Night", [
        ("03-starlight-night-pack.png", "23:32 · patrolling territory"),
        ("03-moonlight.png", "22:00 · moonlight"),
        ("07_pack_howl_dusk.png", "night · pack howl, eyeshine"),
    ])
    grid("compare-showcase.jpg", "Debug rig / signature behaviour", [
        ("05-skeleton-debug-ik.png", "skeleton + AI vectors, POUNCE"),
        ("05-rest.png", "rest state"),
        ("08_debug_skeleton_ai.png", "skeleton + AI target lines"),
    ])
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
