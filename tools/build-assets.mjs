// tools/build-assets.mjs — `pnpm assets`
// assets-src/ → public/: split the drone into animatable parts, optimize it, and cut the
// motor audio clips (§4.5) when the recording and ffmpeg are available. The recording's
// license is unverified (PRD §7), so it's git-ignored: CI and deploys run procedural-only.
// ffmpeg is found on PATH, or set FFMPEG_PATH to the executable.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets-src/drone/scene.gltf');
const RAW = path.join(ROOT, 'public/models/drone.raw.glb');
const OUT = path.join(ROOT, 'public/models/drone.glb');
const GLTF_TRANSFORM = path.join(ROOT, 'node_modules/@gltf-transform/cli/bin/cli.js');
const MP3 = path.join(ROOT, 'assets-src/audio/drone.mp3');
const AUDIO_OUT = path.join(ROOT, 'public/audio');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

const run = (args) => execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });

if (!existsSync(SRC)) {
  console.error(`missing ${path.relative(ROOT, SRC)}: unzip fpv-dron_nonstop.zip into assets-src/drone/`);
  process.exit(1);
}

mkdirSync(path.dirname(OUT), { recursive: true });

console.log('» split');
run([path.join(ROOT, 'tools/split-drone.mjs'), SRC, RAW]);

console.log('» optimize');
// Flags per PRD §2.3: never simplify, keep 4K textures, keep node hierarchy intact.
// prettier-ignore
run([
  GLTF_TRANSFORM, 'optimize', RAW, OUT,
  '--compress', 'meshopt',
  '--texture-compress', 'webp',
  '--texture-size', '4096',
  '--simplify', 'false',
  '--join', 'false',
  '--instance', 'false',
  '--flatten', 'false',
]);
rmSync(RAW);

console.log(`wrote ${path.relative(ROOT, OUT)} (${(statSync(OUT).size / 1e6).toFixed(2)} MB)`);

console.log('» audio');
const hasFfmpeg = (() => {
  try {
    execFileSync(FFMPEG, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!existsSync(MP3)) {
  console.log('assets-src/audio/drone.mp3 absent: skipping clips, the engine runs procedural-only');
} else if (!hasFfmpeg) {
  console.log('ffmpeg not found (set FFMPEG_PATH): skipping clips, the engine runs procedural-only');
} else {
  mkdirSync(AUDIO_OUT, { recursive: true });
  const ff = (args) =>
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  // Loop source: exact samples, lossless (MP3 encoder padding breaks gapless loops).
  // prettier-ignore
  ff(['-i', MP3, '-ss', '2.5', '-to', '10.5', '-ac', '1', '-ar', '44100', path.join(AUDIO_OUT, 'motor_loop.wav')]);
  // One-shots seek on the input (-ss/-to before -i) so fade times are relative to the cut.
  // With output seeking, ffmpeg filters the whole file before trimming, and the PRD's
  // spool-down fade (st=2.4) lands at 2.4 s of the source: the clip came out silent.
  // prettier-ignore
  ff(['-ss', '0.0', '-to', '2.5', '-i', MP3, '-ac', '1', '-af', 'afade=t=in:d=0.05', '-c:a', 'aac', '-b:a', '128k', path.join(AUDIO_OUT, 'spoolup.m4a')]);
  // prettier-ignore
  ff(['-ss', '11.2', '-to', '13.9', '-i', MP3, '-ac', '1', '-af', 'afade=t=out:st=2.4:d=0.3', '-c:a', 'aac', '-b:a', '128k', path.join(AUDIO_OUT, 'spooldown.m4a')]);
  for (const f of ['motor_loop.wav', 'spoolup.m4a', 'spooldown.m4a'])
    console.log(`wrote public/audio/${f} (${(statSync(path.join(AUDIO_OUT, f)).size / 1e3).toFixed(0)} kB)`);
}
