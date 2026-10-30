#!/usr/bin/env python3
"""Render an episode JSON to a 1080x1920 MP4 (30 fps) with a simple generated soundtrack.
Usage: python3 sim/render.py sim/episodes/<id>.json out_dir [--frames a,b,c]  (frames = preview stills only)"""
import functools
import http.server
import json
import math
import pathlib
import shutil
import subprocess
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
FPS = 30


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    handler.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def ffmpeg():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def soundtrack(spec, path):
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    import audio
    audio.build(spec, path)


def finish(spec, out):
    segs = sorted(out.glob("seg_*.mp4"))
    if not segs:
        raise SystemExit("no segments")
    (out / "list.txt").write_text("".join(f"file '{p.name}'\n" for p in segs))
    soundtrack(spec, out / "audio.wav")
    subprocess.run([ffmpeg(), "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(out / "list.txt"),
                    "-i", str(out / "audio.wav"), "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest",
                    "-movflags", "+faststart", str(out / "reel.mp4")], check=True)
    (out / "caption.txt").write_text(spec["caption"], encoding="utf-8")
    print(out / "reel.mp4")


def main():
    spec_path, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    preview = None
    chunk = None
    if "--chunk" in sys.argv:
        i = sys.argv.index("--chunk"); chunk = (int(sys.argv[i + 1]), int(sys.argv[i + 2]))
    if "--finish" in sys.argv:
        finish(spec, pathlib.Path(sys.argv[2]))
        return
    if "--frames" in sys.argv:
        preview = [float(x) for x in sys.argv[sys.argv.index("--frames") + 1].split(",")]
    out.mkdir(parents=True, exist_ok=True)
    frames = out / "frames"
    if frames.exists():
        shutil.rmtree(frames)
    frames.mkdir()
    srv = serve()
    url = f"http://127.0.0.1:{srv.server_address[1]}/sim/engine/index.html"
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        page = b.new_page(viewport={"width": 1080, "height": 1920})
        page.on("console", lambda m: print("console:", m.text) if m.type == "error" else None)
        page.goto(url)
        page.wait_for_function("typeof window.load === 'function'")
        page.evaluate("s => window.load(s)", spec)
        total = int(spec["duration"] * FPS)
        if chunk:
            ca = total * chunk[0] // chunk[1]; cb = total * (chunk[0] + 1) // chunk[1]
            times = [i / FPS for i in range(ca, cb)]
        else:
            times = preview or [i / FPS for i in range(total)]
        for i, t in enumerate(times):
            page.evaluate("t => window.renderAt(t)", t)
            page.screenshot(path=str(frames / f"{i:05d}.jpg"), type="jpeg", quality=88)
            if i % 300 == 0:
                print(f"frame {i}/{len(times)}", flush=True)
        b.close()
    srv.shutdown()
    if preview:
        print("preview frames in", frames)
        return
    if chunk:
        subprocess.run([ffmpeg(), "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", str(frames / "%05d.jpg"),
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high", "-preset", "medium", "-crf", "20",
                        "-r", str(FPS), str(out / f"seg_{chunk[0]:02d}.mp4")], check=True)
        shutil.rmtree(frames)
        print(out / f"seg_{chunk[0]:02d}.mp4")
        return
    soundtrack(spec, out / "audio.wav")
    subprocess.run([ffmpeg(), "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", str(frames / "%05d.jpg"),
                    "-i", str(out / "audio.wav"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high",
                    "-preset", "medium", "-crf", "20", "-r", str(FPS), "-c:a", "aac", "-b:a", "128k", "-shortest",
                    "-movflags", "+faststart", str(out / "reel.mp4")], check=True)
    shutil.rmtree(frames)
    (out / "caption.txt").write_text(spec["caption"], encoding="utf-8")
    print(out / "reel.mp4")


if __name__ == "__main__":
    main()
