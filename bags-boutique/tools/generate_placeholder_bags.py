#!/usr/bin/env python3
"""
Generates placeholder "handmade leather bag" artwork for the boutique demo:
one static cover.svg plus a 12-frame 360-degree turntable sequence per
product, all as lightweight procedural SVG (no binary assets, no network).

Replace these with real product photography later — see bags-boutique/README.md
for the exact folder convention each product expects.
"""
import math
import os

OUT_ROOT = os.path.join(os.path.dirname(__file__), "..", "images", "products")
FRAMES = 12
VB = 480
CX, CY = 240, 250

PRODUCTS = [
    dict(slug="tote-caramel", category="tote", base="#a9713f", dark="#6f4522", light="#d9a86b", hardware="#d9b34a", hw2="#7a5c1e"),
    dict(slug="tote-noir", category="tote", base="#2b2b2b", dark="#101010", light="#4a4a4a", hardware="#cbb26a", hw2="#8a7433"),
    dict(slug="cross-tan", category="crossbody", base="#c48a5a", dark="#8a5a34", light="#e3b98a", hardware="#b8b8b8", hw2="#6f6f6f"),
    dict(slug="cross-burgundy", category="crossbody", base="#5c1f2e", dark="#33101a", light="#8a3a4d", hardware="#d9b34a", hw2="#7a5c1e"),
    dict(slug="clutch-gold", category="clutch", base="#caa156", dark="#8a6a2e", light="#e9cf9a", hardware="#3a3a3a", hw2="#1a1a1a"),
    dict(slug="clutch-emerald", category="clutch", base="#1f4d3d", dark="#0f2b22", light="#3d7f68", hardware="#d9b34a", hw2="#7a5c1e"),
    dict(slug="backpack-cognac", category="backpack", base="#8a4a2a", dark="#5a2e17", light="#b8794f", hardware="#cbb26a", hw2="#8a7433"),
    dict(slug="wallet-mocha", category="wallet", base="#5a3b28", dark="#331f14", light="#8a6547", hardware="#cbb26a", hw2="#8a7433"),
]

CATEGORY_DIMS = {
    "tote": dict(w=190, h=170, top=140),
    "crossbody": dict(w=140, h=140, top=150),
    "clutch": dict(w=200, h=120, top=190),
    "backpack": dict(w=160, h=190, top=110),
    "wallet": dict(w=140, h=100, top=210),
}


def grad(id_, base, light, dark):
    return f'''<linearGradient id="{id_}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="{light}"/>
      <stop offset="45%" stop-color="{base}"/>
      <stop offset="100%" stop-color="{dark}"/>
    </linearGradient>'''


def hw_grad(id_, hardware, hw2):
    return f'''<linearGradient id="{id_}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="{hardware}"/>
      <stop offset="100%" stop-color="{hw2}"/>
    </linearGradient>'''


def stitch(x, y, w, h, rx=14):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" '
            f'fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" '
            f'stroke-dasharray="4 4" />')


def frame_svg(p, frame_idx, n_frames):
    theta = (frame_idx / n_frames) * 2 * math.pi
    cos_t = math.cos(theta)
    sin_t = math.sin(theta)
    scale_x = max(0.48, abs(cos_t))
    facing_front = max(0.0, cos_t)   # 0..1, front detail opacity
    facing_back = max(0.0, -cos_t)   # 0..1, back panel opacity
    highlight_x = CX + sin_t * 90
    sway = sin_t * 8

    dims = CATEGORY_DIMS[p["category"]]
    w, h, top = dims["w"], dims["h"], dims["top"]
    body_x = CX - (w * scale_x) / 2
    body_w = w * scale_x
    body_h = h
    body_y = top

    grad_id = f"g-{p['slug']}"
    hw_id = f"hw-{p['slug']}"
    shine_id = f"sh-{p['slug']}"

    defs = [
        grad(grad_id, p["base"], p["light"], p["dark"]),
        hw_grad(hw_id, p["hardware"], p["hw2"]),
        f'''<radialGradient id="{shine_id}" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/>
              <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
            </radialGradient>''',
        f'''<filter id="blur-{p['slug']}"><feGaussianBlur stdDeviation="6"/></filter>''',
    ]

    shadow = (f'<ellipse cx="{CX}" cy="{top + body_h + 16}" rx="{max(40, body_w*0.75)}" ry="16" '
              f'fill="#000" opacity="0.22" filter="url(#blur-{p["slug"]})"/>')

    body_rx = 22 if p["category"] != "clutch" else 10
    body = f'<rect x="{body_x:.1f}" y="{body_y}" width="{body_w:.1f}" height="{body_h}" rx="{body_rx}" fill="url(#{grad_id})"/>'
    body_stitch = stitch(body_x + 8, body_y + 8, max(0, body_w - 16), body_h - 16, rx=max(4, body_rx - 6))

    extras = []

    if p["category"] == "tote":
        handle_gap = 46 * scale_x
        handle_rise = 46 * (0.5 + 0.5 * scale_x)
        for dx in (-handle_gap, handle_gap):
            hx = CX + dx + sway * 0.3
            extras.append(f'<path d="M {hx-4:.1f} {body_y} q 4 {-handle_rise:.1f} {8*scale_x:.1f} {-handle_rise:.1f} q {4} 0 {8*scale_x:.1f} {handle_rise:.1f}" '
                          f'fill="none" stroke="url(#{hw_id})" stroke-width="7" stroke-linecap="round" opacity="{0.4+0.6*scale_x:.2f}"/>')
        flap_w = body_w * 0.55
        extras.append(f'<rect x="{CX-flap_w/2:.1f}" y="{body_y+14}" width="{flap_w:.1f}" height="34" rx="8" '
                      f'fill="rgba(0,0,0,0.12)" opacity="{facing_front:.2f}"/>')

    elif p["category"] == "crossbody":
        strap_span = 70 * scale_x
        strap_rise = 55 * (0.5 + 0.5 * scale_x)
        strap_x1 = CX - strap_span + sway
        strap_x2 = CX + strap_span - sway
        extras.append(f'<path d="M {strap_x1:.1f} {body_y-20} Q {CX} {body_y-20-strap_rise:.1f} {strap_x2:.1f} {body_y-20}" '
                      f'fill="none" stroke="url(#{grad_id})" stroke-width="14" stroke-linecap="round"/>')
        extras.append(f'<circle cx="{CX}" cy="{body_y+body_h*0.32:.1f}" r="{9*scale_x:.1f}" fill="url(#{hw_id})"/>')
        flap_h = body_h * 0.45
        extras.append(f'<path d="M {body_x:.1f} {body_y} h {body_w:.1f} v {flap_h:.1f} '
                      f'q {-body_w/2:.1f} 22 {-body_w:.1f} 0 Z" fill="rgba(0,0,0,0.14)" opacity="{facing_front:.2f}"/>')

    elif p["category"] == "clutch":
        extras.append(f'<rect x="{CX-body_w*0.28:.1f}" y="{body_y-4}" width="{body_w*0.56:.1f}" height="10" rx="5" '
                      f'fill="url(#{hw_id})" opacity="{0.5+0.5*scale_x:.2f}"/>')
        chain_x = CX + (60 if cos_t >= 0 else -60) * (1 if scale_x > 0.5 else 0.4)
        extras.append(f'<path d="M {chain_x:.1f} {body_y} q 30 40 0 78" fill="none" '
                      f'stroke="url(#{hw_id})" stroke-width="3" stroke-dasharray="2 3" opacity="0.85"/>')

    elif p["category"] == "backpack":
        for dx in (-38, 38):
            sx = CX + dx * scale_x + sway * 0.4
            extras.append(f'<path d="M {sx:.1f} {body_y+6} q 6 90 0 170" fill="none" '
                          f'stroke="url(#{grad_id})" stroke-width="16" stroke-linecap="round" opacity="0.92"/>')
        extras.append(f'<path d="M {CX-body_w*0.4:.1f} {body_y} q {body_w*0.4:.1f} -34 {body_w*0.8:.1f} 0 Z" '
                      f'fill="rgba(0,0,0,0.16)" opacity="{facing_front:.2f}"/>')
        extras.append(f'<circle cx="{CX:.1f}" cy="{body_y+30}" r="{7*scale_x:.1f}" fill="url(#{hw_id})"/>')

    elif p["category"] == "wallet":
        extras.append(f'<rect x="{CX-body_w*0.32:.1f}" y="{body_y+body_h*0.42:.1f}" width="{body_w*0.64:.1f}" height="6" rx="3" '
                      f'fill="url(#{hw_id})" opacity="{0.5+0.5*scale_x:.2f}"/>')

    back_panel = ""
    if facing_back > 0.05:
        back_panel = (f'<rect x="{body_x:.1f}" y="{body_y}" width="{body_w:.1f}" height="{body_h}" rx="{body_rx}" '
                     f'fill="{p["dark"]}" opacity="{facing_back*0.35:.2f}"/>')

    highlight = (f'<ellipse cx="{highlight_x:.1f}" cy="{body_y+body_h*0.28:.1f}" rx="{max(10, body_w*0.22):.1f}" ry="{body_h*0.5:.1f}" '
                f'fill="url(#{shine_id})"/>')

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="20 30 440 350">
  <defs>{''.join(defs)}</defs>
  {shadow}
  {body}
  {back_panel}
  {body_stitch}
  {''.join(extras)}
  {highlight}
</svg>'''
    return svg


def main():
    for p in PRODUCTS:
        out_dir = os.path.join(OUT_ROOT, p["slug"])
        spin_dir = os.path.join(out_dir, "360")
        os.makedirs(spin_dir, exist_ok=True)
        for i in range(FRAMES):
            svg = frame_svg(p, i, FRAMES)
            with open(os.path.join(spin_dir, f"frame-{i:02d}.svg"), "w", encoding="utf-8") as f:
                f.write(svg)
        # cover = frame 0 (front-facing)
        cover_svg = frame_svg(p, 0, FRAMES)
        with open(os.path.join(out_dir, "cover.svg"), "w", encoding="utf-8") as f:
            f.write(cover_svg)
        print(f"generated {p['slug']}: cover.svg + {FRAMES} frames")


if __name__ == "__main__":
    main()
