#!/usr/bin/env python3
"""Headless Blender export — used once licensed .blend sources exist.

Until §2 is resolved the meshes are original procedural geometry in
engine3/mesh.js (MIT, this repo). This script is the seam those blends will
occupy: decimate, validate UVs, bake morphs, export glTF + Draco + KTX2.

    blender --background --python art/scripts/export.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "art" / "src"
BUILD = ROOT / "art" / "build"


def main() -> int:
    blends = sorted(SRC.glob("*.blend")) if SRC.exists() else []
    if not blends:
        print("no art/src/*.blend yet — engine3/mesh.js is the source of truth")
        print("licence the base meshes (extended / buyout / CC0) before this path does work")
        BUILD.mkdir(parents=True, exist_ok=True)
        return 0
    try:
        import bpy  # type: ignore
    except ImportError:
        print("run this with blender --background --python art/scripts/export.py", file=sys.stderr)
        return 2
    BUILD.mkdir(parents=True, exist_ok=True)
    for blend in blends:
        bpy.ops.wm.open_mainfile(filepath=str(blend))
        out = BUILD / (blend.stem + ".glb")
        bpy.ops.export_scene.gltf(
            filepath=str(out),
            export_format="GLB",
            export_draco_mesh_compression_enable=True,
            export_morph=True,
            export_skins=True,
            export_animations=True,
        )
        print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
