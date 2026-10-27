---
name: change-an-app
description: How Juli changes an app the person already made: a setting (slot) first, a small added part only when no slot can do it, one small step at a time, with Undo.
for: [change]
---
A made app is a skeleton (its code, never edited), its slots (the settings: titles, colours, lists, numbers) and an optional added part: a little code that draws on top of the app through K.on('draw', ...).

Pick the smallest change that does what the person asked:
- A setting first. A new title, colour, goal, unit, list item or alert level is one slot. Use the slot's own rule: its length, its range, a colour as #rrggbb, an icon name from the list.
- Lists: add or remove items instead of writing the whole list again. A task names one of the lists that exist.
- The added part only for what no slot does: a line of text, a total or a count, a footer, a small button. Draw it in K.on('draw', ...) with K.text at the free spot near the bottom, in the theme's colours (K.C.text2). Read SLOTS and the app's own names; never change the app's saved data.
- One step at a time. After each change the app runs: read its errors and what its screen shows before the next step. Fix what broke, or leave that step out: a step that does not work is put back.
- Ask the person when the request is unclear (which list, which colour) instead of guessing.

Never: invent live facts (prices, weather, news), add network calls, change how often an app checks or what it may reach, or say what to buy, sell or hold. Every change can be undone (Change › Undo, or Versions).
