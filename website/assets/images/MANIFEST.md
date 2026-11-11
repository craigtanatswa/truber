# Website v2 images: manifest

## Provenance
All four images were AI-generated with Grok Imagine by Brian on 10 Nov 2026, at about 16:17 Africa/Harare. They are not photographs. They show no real customers, brands, logos, readable plates or readable signage. The prompts are in the Brian chat transcript.
`scene-3-delivered` is the warm, clear-light regeneration (16:19 CAT). The earlier overcast version (`scene-3-delivered-overcast-rejected.jpg`) was rejected by Design and is not shipped.

## Processing
1. Source: 1280×720 JPG from `design/website/images-v2-2026-11-10/`.
2. Upscale ×2 to 2560×1440 with **Real-ESRGAN `RealESRGAN_x2plus`** (official weights from xinntao/Real-ESRGAN release v0.2.1, sha256 `49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb`). It ran on CPU with PyTorch 2.15 and spandrel, in 256 px tiles with 16 px overlap. There was no colour grading and no other retouching.
3. Downscale with Lanczos to 640, 1280 and 1920 widths, all 16:9.
4. Encode with Pillow 13:
   - AVIF at quality 55 (640 and 1280) or 50 (1920 and 2560), speed 4.
   - WebP at quality 74, method 6.
   - Progressive JPG fallback at quality 78, at 1280 and 1920 only.
5. Served through `<picture>`: AVIF, then WebP, then JPG. Each image has explicit `width="2560" height="1440"`. The hero uses `fetchpriority="high"`; everything else uses `loading="lazy"`.

## Images

### hero-highway
- Use: Home hero (fetchpriority high, eager)
- Alt text: "An unbranded white truck with a covered trailer on a two-lane highway through dry bushveld, with granite kopjes under a clear blue sky."
- Source `hero-highway.jpg` (1280×720) sha256 `34c2817e9dd41c118f3a8a6705e65ae076b78bf983b3f25cddbc1f58bb8d9fc9`

| File | Bytes | sha256 |
|---|---|---|
| `hero-highway-1280.avif` | 49697 | `d4d783e442ef214cad949fb4a6fdd4dca0fb4a5f7f22aaaa2a6852a438f75f93` |
| `hero-highway-1280.jpg` | 106069 | `ce7311517077a6c8860297509930144890d6ee70f0de863e9ec78423c8778611` |
| `hero-highway-1280.webp` | 63060 | `268b291125da975d81c44cc862b16ee7e8b5e551d588bb67ee77005e54aed436` |
| `hero-highway-1920.avif` | 76378 | `54b6b25900a31a0eb6016f087c3ddae31d4537768995fd3aed4863e95add4fc7` |
| `hero-highway-1920.jpg` | 211390 | `00234fe5146d7abcd275f4687f47b6477332fe00564578cac332d5aa4b8627ca` |
| `hero-highway-1920.webp` | 119072 | `5c87d3c4b5c36ec74ab980c4151b513b8bacd6848ec97881bce800255f0759f3` |
| `hero-highway-2560.avif` | 119137 | `583cb84aa0b6e671bc8068344f767a9ea728eb2dfeb707b3c4ec1108efd69b0b` |
| `hero-highway-2560.webp` | 182912 | `0446f7ebf352750b63ab0119c38dea898b57da8c01653d9b99f1bd7c72b03e04` |
| `hero-highway-640.avif` | 13776 | `e9ad83d28216561056fe45ab3267c4fae737a05d5da3ba2c549d7580caf4b470` |
| `hero-highway-640.webp` | 17422 | `8c529ffcdd27d7ff20a49021751390d6c0e8657bf5ca552b2cfbf76f2adb0c8b` |

### scene-1-depot
- Use: Home pinned scene, step 1 (lazy)
- Alt text: "A freight depot yard with red earth, white box trucks at the loading dock, pallets of bagged goods and a forklift."
- Source `scene-1-depot.jpg` (1280×720) sha256 `54904f36c2d6120691893966500519041ba62cc088ca0b3ca0a23648040e6572`

| File | Bytes | sha256 |
|---|---|---|
| `scene-1-depot-1280.avif` | 62480 | `dd081585ffb4460ff2211a6959f4ff368e684d41cc5e8d84ec2a4d6286be7276` |
| `scene-1-depot-1280.jpg` | 127298 | `a82d380772fb3a07a5387f37e9d755e29e06737d51eb581838b30cd4f0592b0d` |
| `scene-1-depot-1280.webp` | 75122 | `b1e14a1037c21c6c84696bf8db4b25de06744214fd0699a0c52a3f2c16d938e8` |
| `scene-1-depot-1920.avif` | 95825 | `011120705774ce2425962339da2de0ce664cd794afb6a3c747d89b16fd89b7e2` |
| `scene-1-depot-1920.jpg` | 249546 | `c3f6bf5c2d3e5d03fd1aaa1a7b0e08fa05cf6a9c8388223f0ca0a90a7c863d1e` |
| `scene-1-depot-1920.webp` | 133602 | `914ac6d764c2a7a2c905b5e644df7141d1bbfaf5cff01b470ba15b18823bbb9b` |
| `scene-1-depot-2560.avif` | 143853 | `0519d9f04f821f64efb88b28e5d0c6054a262db3fc6f5437f971cc3df0103f51` |
| `scene-1-depot-2560.webp` | 196206 | `9c33a99f2341f5bb2a0d7b4d3777d8784189a6980ae701262e0afcd7a0aed802` |
| `scene-1-depot-640.avif` | 17750 | `2bcc18c745dcffc3756b15abf35821dc304f45d1bdf748acdf5d7267ff78f5cd` |
| `scene-1-depot-640.webp` | 22800 | `01362cc5fd5aafe5b2d30d466d7d3a709a3e5bd496487bc08c9514515cab87d7` |

### scene-2-route
- Use: Home pinned scene, step 2 (lazy)
- Alt text: "Aerial view of a truck on a winding road across dry Southern African savanna, with hills on the horizon."
- Source `scene-2-route.jpg` (1280×720) sha256 `60f2ebb05dd25bce4d7925c483e050b1b331c54ebbefe4e809701fa1b37e2105`

| File | Bytes | sha256 |
|---|---|---|
| `scene-2-route-1280.avif` | 117181 | `b89228f0cd1059ff5149cc22893cbab6c2941c3d8097e2b270ca377838ea6e09` |
| `scene-2-route-1280.jpg` | 215420 | `e267a434d230f75061d037cd6aeb1bcceac361ed0b171e34ec1a5475999cd689` |
| `scene-2-route-1280.webp` | 163860 | `181308817fb53c9c4b8cde32fc041850eba39f1521698497a87040dba4242bf9` |
| `scene-2-route-1920.avif` | 178157 | `a51f082d3e8897f41855b3deea94380e210c6aa026b6209b2d82383a3bbba981` |
| `scene-2-route-1920.jpg` | 425654 | `7a44ce57f9d10529173452097139f772f384ec790ead2a1e9f880720033f919d` |
| `scene-2-route-1920.webp` | 297174 | `030e491a22c9dac083eed7fbcc28dbd8b25af55509fbffeb2586c1c2b480cc53` |
| `scene-2-route-2560.avif` | 274378 | `c79c4cb0511d950603380f313eb7f1d66ffb46cfbdf269ad86bdc36886c12de6` |
| `scene-2-route-2560.webp` | 438602 | `0c091307d3fa28d1ae18cce19494016e66669f541812a2d83f81d6e4a94eb8ff` |
| `scene-2-route-640.avif` | 31021 | `08e6f799fd100200eefc48847a15fa9cbc219bd7928e552110868b8d102ce0bb` |
| `scene-2-route-640.webp` | 45446 | `d6aec16460bd611c087e4fd1037d68f09ed5ad881405e75dda073480ae17ef75` |

### scene-3-delivered
- Use: Home pinned scene, step 3 (lazy)
- Alt text: "Boxed cargo on pallets beside an open delivery truck at a receiving bay, with a clipboard on a wooden crate."
- Source `scene-3-delivered.jpg` (1280×720) sha256 `fd423cbd45bffd1202520d2d819f26ea5c8e09fccfac669c921cb7e4324c3dd0`

| File | Bytes | sha256 |
|---|---|---|
| `scene-3-delivered-1280.avif` | 51983 | `a6dbb4a9f0c93d33246b6f2f77e4611c1eb170423e294a36d82b824f72112340` |
| `scene-3-delivered-1280.jpg` | 125198 | `2524a0f1ed094f8168fdde5bb7047bd82914bb8d55772c615958d6cc670837f5` |
| `scene-3-delivered-1280.webp` | 61840 | `d87c5f4944eda4812430b808e58afce97c9ba092c47ce5b092f0e0df0a692ec3` |
| `scene-3-delivered-1920.avif` | 78888 | `01d345b69d4e4129ae92dbd520d12c02c823271c4b1aa58608dc078dbd191c2f` |
| `scene-3-delivered-1920.jpg` | 242427 | `c6d27784259e12f5f9ddfeb3ac01fae3a27d00d658a10ba06a6d311aeb046070` |
| `scene-3-delivered-1920.webp` | 108622 | `dd020c46515241684feac3715673690a29d72ef9c2db916ac4d6d04fd054c013` |
| `scene-3-delivered-2560.avif` | 116541 | `7b51c5dd50547a97040722a79507a8924de648709e4c992ed5423e7050e5ff47` |
| `scene-3-delivered-2560.webp` | 159416 | `d0685e1e87f5f16f83e5bea6691acd520b491b722af720a7ed933ff0ff4b3cbf` |
| `scene-3-delivered-640.avif` | 15489 | `755f9380b10807a3fdd9f95ca2c2c5d31a5c84add59bc5bf2d00f708b81d281e` |
| `scene-3-delivered-640.webp` | 19230 | `f8cfee408221ad496ef4d3055f9dd026d5511bc1f45a664d2657f9c87a9791c9` |

## Video: hero-truck-drive
- Use: Home hero background video, attached by /hero-video.js after window load; muted, playsinline, loop, preload="none", no autoplay attribute. Still (and LCP) is the existing hero-highway image, which matches the video's first frame closely: the `<picture>` underneath and `poster="/assets/images/hero-highway-1280.avif"` on the video, so no new poster file is shipped.
- Source: AI-generated with Grok Imagine from the hero-highway still (image-to-video). Prompt: per Design (not recorded in design/website/video-v2/). Delivered by Design as design/website/video-v2/hero-truck-drive-1280.mp4 (H.264, 1280x720, 24 fps, 8.04 s, no audio, faststart), sha256 fcedf3b908e8a71a5960d80f06ed355b4e2df6f0db277b9ebcfeee6278b458e9.
- Content: unbranded white truck with covered trailer on a two-lane highway through bushveld with granite kopjes. No real brands, logos, readable plates, signage or people (frames checked at 1 s intervals and the last frame).
- Processing: metadata stripped with ffmpeg 7 (`-map_metadata -1 -map_chapters -1 -c copy -bsf:v filter_units=remove_types=6 -fflags +bitexact -movflags +faststart`); no re-encode. SEI user data (encoder settings) removed; video stream bit-identical otherwise.

| File | Bytes | sha256 |
|---|---|---|
| `assets/video/hero-truck-drive-1280.mp4` | 926463 | `b4d9f05e60e7b6dce9c3bae5063b2f4fed88fd8b04f6eac665167c6fecadef98` |
