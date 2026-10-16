# The popcorn progress animation - how it was made

The picture p0pc0rn shows while it works (kernels heating up and popping on a black surface, popcorn/atlas.webp and atlas.jpg) is
AI-generated. It is NOT made on your phone and it is not a model file: it is a fixed set of 110 small frames shipped with the app.

- Video: LTX-2.3 22B (Lightricks), image-to-video with a first frame and a last frame, 121 frames at 24 fps, rendered on Josh Hughes'
  own computer on October 12, 2026. LTX-2 Community License Agreement (LICENSE-LTX-2.txt): Lightricks
  claims no rights in outputs; the Agreement's use restrictions (paragraph 4 and Attachment A) applied to making it.
- First frame (raw kernels) and last frame (the popped pile): FLUX.2 [klein] 9B (Black Forest Labs) stills, the last one an
  image-to-image edit of the first, composited back onto the first frame's tabletop so the lighting stays the same.
- From the clip: 101 frames picked so that the amount of popped corn only goes up (frame N = N % done), plus 9 early frames for the
  "heating up" loop; cropped, edges faded to the surface colour, packed into one 11 x 10 grid of 448 x 252 frames.

Shown here for transparency. No person, brand or third-party artwork is in it.
