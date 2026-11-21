// Download a YouTube video of a BW textured promo and cut frames from a tilt run.
//
// Run:
//   py -m venv tmp/.venv && tmp/.venv/Scripts/python.exe -m pip install yt-dlp imageio-ffmpeg
//   node tmp/fetch-video-frames.mjs
//
// Why video: the still photographs only exist at 900–1200 px, and a tilted card in
// one frame is foreshortened and hand-cropped. A video gives a run of frames at one
// lens and one light, so the card can be measured on the frame where it lies flat
// and square-on — which is the only way the ridge pitch is readable as a period
// rather than as perspective.
//
// The frames are cut from the video-only stream: no audio is needed to measure a
// surface, and it halves the download. Everything lands in tmp/ and nothing is
// committed — these are copyrighted images.
//
// Candidates came from tmp/fetch-videos.mjs. `dFI0NbvBygY` is the useful one: its
// first minute shows three BW-era full-art promos, and around 84–97 s the English
// BW73 (printed BW73, 2013) lies flat on a desk under a single lamp.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const PY = process.platform === 'win32' ? 'tmp/.venv/Scripts/python.exe' : 'tmp/.venv/bin/python'
const OUT = 'tmp/refs-textured/video'
const RUN = path.join(OUT, 'run')
fs.mkdirSync(RUN, { recursive: true })

if (!fs.existsSync(PY)) {
  console.error(`no venv at ${PY} — see the header for the two install commands`)
  process.exit(1)
}

// The bundled ffmpeg, so no system install is required.
const FF = execFileSync(PY, ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], {
  encoding: 'utf8',
}).trim()

const VIDEOS = [{ id: 'dFI0NbvBygY', title: '3 Full Art Promo Pokemon Cards (BCBM)' }]

for (const { id, title } of VIDEOS) {
  const mp4 = path.join(OUT, `${id}.mp4`)
  if (!fs.existsSync(mp4)) {
    console.log(`downloading ${id} — ${title}`)
    execFileSync(
      PY,
      [
        '-m',
        'yt_dlp',
        '-f',
        'bv*[height<=1080][ext=mp4]/bv*[height<=1080]/b[height<=1080]',
        '-o',
        path.join(OUT, '%(id)s.%(ext)s'),
        '--no-playlist',
        '--no-part',
        '-q',
        `https://www.youtube.com/watch?v=${id}`,
      ],
      { stdio: 'inherit' },
    )
  }
  // 4 fps across the flat-on run: 90 s to 97 s. 012 and 022 are the two frames
  // tmp/measure-textured.ts measures, and they are the ones where the card lies
  // flattest and the light rakes most evenly across it.
  const frames = fs.readdirSync(RUN).filter((f) => f.endsWith('.png'))
  if (frames.length < 28) {
    console.log('cutting frames from 90 s at 4 fps')
    execFileSync(
      FF,
      ['-loglevel', 'error', '-ss', '90', '-t', '7', '-i', mp4, '-vf', 'fps=4', path.join(RUN, '%03d.png')],
      { stdio: 'inherit' },
    )
  }
  console.log(`${id}: ${fs.readdirSync(RUN).filter((f) => f.endsWith('.png')).length} frames in ${RUN}`)
}
