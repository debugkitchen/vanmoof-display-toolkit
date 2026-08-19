#!/usr/bin/env python3
"""Extract all SX3 display images from a VanMoof firmware binary and emit
the Arduino header consumed by arduino/sx3_display_gallery/.

Usage:  python3 extract_images.py mainware_1_9_3.bin  > sx3_images_all.h

The firmware binary is NOT distributed with this repo. Supply your own.

Names and addresses are loaded from ../editor/gallery/firmware_gallery.json
(the output of the web editor's naming tool) rather than being hardcoded
here, so this script always matches the editor's gallery -- regenerate that
JSON first if you want to extract a different/updated set of images.

Image container layout (little-endian uint32 words):
    word0 start_row, word1 graphic_rows, word2 num_frames,
    then num_frames timing words, then frame-interleaved pixel words:
        pixelWord(relRow, frame) = num_frames*relRow + frame + num_frames + 3
"""
import json, os, struct, sys

FLASH_BASE = 0x08020000
GALLERY_JSON = os.path.join(os.path.dirname(__file__),
                             "..", "editor", "gallery", "firmware_gallery.json")


def load_images():
    """(name, addr) pairs, in gallery order, from firmware_gallery.json."""
    with open(GALLERY_JSON, encoding="utf-8") as f:
        gallery = json.load(f)
    return [(img["name"], img["addr"]) for img in gallery["images"]]


def category_for(num_frames):
    """0=static 1=short 2=medium 3=long, derived from frame count."""
    if num_frames <= 1:
        return 0
    if num_frames < 10:
        return 1
    if num_frames < 40:
        return 2
    return 3


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: extract_images.py <firmware.bin>")
    data = open(sys.argv[1], "rb").read()
    u32 = lambda o: struct.unpack_from("<I", data, o)[0]

    images = load_images()
    out = ["#ifndef SX3_IMAGES_ALL_H", "#define SX3_IMAGES_ALL_H",
           "#include <Arduino.h>", ""]
    table = []
    for name, addr in images:
        off = addr - FLASH_BASE
        sr, gr, nf = u32(off), u32(off + 4), u32(off + 8)
        max_word = nf * (gr - 1) + (nf - 1) + nf + 3
        n = (max_word + 1) * 4
        blob = data[off:off + n]
        cat = category_for(nf)
        out.append(f"// {name}: start_row={sr} rows={gr} frames={nf} {n} bytes")
        out.append(f"const uint8_t SX3IMG_{name}[] PROGMEM = {{")
        for i in range(0, len(blob), 16):
            out.append("  " + ", ".join(f"0x{b:02X}" for b in blob[i:i + 16]) + ",")
        out.append("};")
        out.append("")
        table.append((name, cat))
    out.append("struct SX3Image { const char* name; const uint8_t* data; uint8_t category; };")
    out.append("const SX3Image SX3_IMAGES[] = {")
    for name, cat in table:
        out.append(f'  {{ "{name}", SX3IMG_{name}, {cat} }},')
    out.append("};")
    out.append(f"const int SX3_IMAGE_COUNT = {len(table)};")
    out.append("")
    out.append("#endif")
    print("\n".join(out))


if __name__ == "__main__":
    main()
