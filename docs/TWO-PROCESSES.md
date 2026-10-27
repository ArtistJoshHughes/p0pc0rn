# Two processes, one model: how the Bigger brain fits on an iPhone

Since 3.8, p0pc0rn runs NVIDIA Nemotron 3.5 Bolt E4B, a 4.7 GB model, inside Safari on an iPhone. Safari gives a web page about 1.8 GB of
memory before iOS ends it, and the Bigger brain needs about 3 GB on the graphics chip. It fits because, on iOS 27, p0pc0rn runs the
model in **two processes**: the page, and a helper with a memory budget of its own. Each holds part of the model's weights, and every
token passes from one to the other. This page explains how that works, what it costs, and where it can break.

This isn't a documented Safari feature. We found it by testing on iOS 27, so a future iOS update could change it.

## The limit

Each web page in Safari runs in a web content process, and iOS ends that process when it uses more memory than its budget. On an
iPhone 16 Pro Max with iOS 27, that is about 1.8 to 1.9 GB, counting what the page has on the graphics chip. Juli's quick model,
Gemma 4 E2B, fits in one page. The Bigger brain doesn't: its layers and embedding alone are about 2.9 GB, before its memory for the
conversation (the KV cache).

## The way around it

A web page can start workers. Most run inside the page's own process and share its budget. On iOS 27 one kind gets a process of its
own: a **module SharedWorker whose script is served with the header `Cross-Origin-Embedder-Policy: require-corp`**. That process has
its own memory budget, about 1.6 GB, and its own WebGPU device. One web address gets one such helper; a service worker can use the
graphics chip too, but it shares the page's budget.

p0pc0rn is served from GitHub Pages, which can't add headers to a file. So p0pc0rn's own service worker (`sw.js`) does it. It answers
exactly one request, `engine/llm/lworker_coep.js`, with the app's `engine/llm/lworker.js` plus that header. Every other request goes
to the network untouched, and it stores nothing.

## The split

A language model is a stack of layers that each token passes through in order. The Bigger brain has 42. p0pc0rn cuts the stack in two:

| | The helper (second process) | The page |
|---|---|---|
| Runs | layers 0 to 23, with their KV caches | the token's embedding, its per-layer inputs, layers 24 to 41, the output head, and the drafter (faster replies) |
| Memory on the graphics chip (p0pc0rn 3.9; 3.8's split at 23: 1,434 MB and 1,596 MB, measured on an iPhone 16 Pro Max, iOS 27.0.1) | 1,499 MB | 1,530 MB |

For every token, or every check of the drafter's guesses:

1. The page looks up the token's embedding and its per-layer inputs, and sends them to the helper: about 50 KB for one token.
2. The helper runs layers 0 to 23 on its own graphics device and sends the result back: the token's hidden row (2,560 numbers),
   plus the keys and values of layers 22 and 23. The page's later layers reuse those keys and values, because this model shares
   them between layers, and the drafter reads them too.
3. The page runs layers 24 to 41 and the head, and picks the next token.

The two halves take turns, never running at the same time. Both processes share one graphics chip, and when one kept it busy, the
other ran about 13 times slower. The messages cost 1 to 3% of the time per token. The words are the same as in one process: on a
desktop browser, where both ways run, the split and the one-process model give the same tokens.

The helper reads its layers from the copy of the model p0pc0rn downloaded and checked into this device's storage. It never fetches
weights itself.

## What it gives

- **The Bigger brain on a phone at all:** 3.0 GB across the two processes. On an iPhone 16 Pro Max with iOS 27.0.1, it answers at
  about 16 tokens a second with its drafter, and reads a long prompt at about 110 tokens a second.
- **Room for Juli:** her quick model splits too (layers 0 to 12 in the helper: page 1,266 MB, helper 429 MB). That leaves room for
  faster replies next to a long prompt, which one process didn't have on iOS 27.

Only one of the two models is loaded at a time. Switching takes a few seconds.

## Where it can break, and what p0pc0rn does

- **iOS can end the helper while p0pc0rn is in the background**, for example during a phone call. When a job comes back to a missing or
  stalled helper, p0pc0rn starts a fresh one and runs the job again, without asking. If that fails too, p0pc0rn stops using the
  helper until you reopen it: Juli carries on in one process, and the Bigger brain's work goes to her.
- **No helper:** if the helper can't start (an older iOS, or a browser without these workers), Juli runs in one process as before,
  and the Bigger brain isn't offered.
- **On a computer**, Chrome and Edge have the memory, so both models run in one process there. Safari on a Mac takes the same
  two-process path as the iPhone (Safari 27). Android doesn't get the Bigger brain yet.

## See it on your phone

Settings › Benchmark › Quick shows how each model loaded, for example: "split, layers 0-23 in a second process (page 1530 MB +
second process 1499 MB, COEP require-corp)".

## The code

- `sw.js`: the service worker that adds the header to that one file.
- `engine/llm/split.js`: the page's side: it starts the helper, sends each token across and handles failures.
- `engine/llm/lworker.js`: the helper: it loads its layers from storage and runs them on its own WebGPU device.
- [ENGINE_API.md](../ENGINE_API.md), section 9: the engine options (`split`, `splitFallback`) and error codes.
- The GPU kernels both processes run are published separately under MPL-2.0 in
  [p0pc0rn-kernels](https://github.com/ArtistJoshHughes/p0pc0rn-kernels).
